// Local OCR by running the system `tesseract` binary.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

// Fedora's location first, then other common distro locations.
const TESSDATA_CANDIDATES = [
    '/usr/share/tesseract/tessdata',
    '/usr/share/tessdata',
    '/usr/share/tesseract-ocr/5/tessdata',
];

async function listModels(dir) {
    const children = await Gio.File.new_for_path(dir).enumerate_children_async(
        'standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
    const langs = [];
    let infos;
    while ((infos = await children.next_files_async(64, GLib.PRIORITY_DEFAULT, null)).length) {
        for (const info of infos) {
            const name = info.get_name();
            if (name.endsWith('.traineddata') && name !== 'osd.traineddata')
                langs.push(name.slice(0, -'.traineddata'.length));
        }
    }
    await children.close_async(GLib.PRIORITY_DEFAULT, null);
    return langs;
}

/** Installed language models, e.g. ['deu', 'eng']. Uses the first tessdata dir found. */
export async function availableLanguages() {
    const env = GLib.getenv('TESSDATA_PREFIX');
    for (const dir of env ? [env] : TESSDATA_CANDIDATES) {
        try {
            const langs = await listModels(dir);
            langs.sort();
            return langs.length ? langs : ['eng'];
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`textsnip: could not list ${dir}: ${e.message}`);
        }
    }
    return ['eng'];
}

let counter = 0;

export async function recognize(pixbuf, language, cancellable = null) {
    const file = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_runtime_dir(),
        `textsnip-${counter++}.png`,
    ]));
    const [, png] = prepare(pixbuf).save_to_bufferv('png', [], []);
    await file.replace_contents_bytes_async(new GLib.Bytes(png), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    const path = file.get_path();

    try {
        let proc;
        try {
            proc = Gio.Subprocess.new([
                'tesseract', path, 'stdout',
                '-l', language,
                '--psm', '3',
                '--dpi', '300',
                '-c', 'preserve_interword_spaces=1',
            ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            if (e.matches?.(GLib.SpawnError, GLib.SpawnError.NOENT))
                throw new Error('tesseract is not installed (sudo dnf install tesseract)');
            throw e;
        }

        // Gio.Cancellable.connect() takes just a callback (not a signal name) and
        // runs it right away if already cancelled.
        const cancelId = cancellable?.connect(() => proc.force_exit());
        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
            if (!proc.get_successful())
                throw new Error(`tesseract failed: ${stderr.trim()}`);
            return stdout.replaceAll('\f', '').trim();
        } finally {
            if (cancelId)
                cancellable.disconnect(cancelId);
        }
    } finally {
        file.delete_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
}

// Screen text is small, anti-aliased and often light-on-dark; Tesseract is trained on
// ~300 dpi dark-on-light scans. Bridge that gap.
function prepare(pixbuf) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const channels = pixbuf.get_n_channels();
    const stride = pixbuf.get_rowstride();
    const src = pixbuf.read_pixel_bytes().toArray();

    const gray = new Uint8Array(width * height * 3);
    let sum = 0;
    for (let y = 0; y < height; y++) {
        let i = y * stride;
        let o = y * width * 3;
        for (let x = 0; x < width; x++, i += channels, o += 3) {
            const l = (src[i] * 299 + src[i + 1] * 587 + src[i + 2] * 114) / 1000 | 0;
            gray[o] = gray[o + 1] = gray[o + 2] = l;
            sum += l;
        }
    }
    if (sum / (width * height) < 128) {
        for (let i = 0; i < gray.length; i++)
            gray[i] = 255 - gray[i];
    }

    let image = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(gray),
        GdkPixbuf.Colorspace.RGB, false, 8, width, height, width * 3);

    const longest = Math.max(width, height);
    const factor = longest < 1200 ? 3 : longest < 2400 ? 2 : 1;
    if (factor > 1) {
        image = image.scale_simple(width * factor, height * factor,
            GdkPixbuf.InterpType.BILINEAR);
    }

    // Text touching the border is often dropped; give it some white margin.
    const pad = 24;
    const w = image.get_width();
    const h = image.get_height();
    const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8,
        w + 2 * pad, h + 2 * pad);
    canvas.fill(0xffffffff);
    image.copy_area(0, 0, w, h, canvas, pad, pad);
    return canvas;
}
