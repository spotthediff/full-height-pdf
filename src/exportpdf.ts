import * as vscode from "vscode";
import * as fs from "node:fs";
import * as puppeteer from "puppeteer-core";
import markdownit from "markdown-it";
import kt from "@vscode/markdown-it-katex";
import * as path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import jschardet from "jschardet";


async function addStyle(page: puppeteer.Page): Promise<void> {
    const css_path = expanduser(vscode.workspace.getConfiguration("full-height-pdf")["styleSheet"]);
    if (css_path !=="" && fs.existsSync(css_path) && fs.lstatSync(css_path).isFile()) {
        await page.addStyleTag({ path: css_path });
    }
    let output_line_height = "";
    if (vscode.workspace.getConfiguration("full-height-pdf")["lineHeight"] !== "") {
        output_line_height = `p {
                    line-height: ${vscode.workspace.getConfiguration("full-height-pdf")["lineHeight"]};
        }`;
    }

    let output_general_font_family = "";
    if (vscode.workspace.getConfiguration("full-height-pdf")["generalFontFamily"] !== "") {
        output_general_font_family = `h1,h2,h3,h4,h5,h6,p,td {
                    font-family: ${vscode.workspace.getConfiguration("full-height-pdf")["generalFontFamily"]};
        }`;
    }
    let output_mono_font_family = "";
    if (vscode.workspace.getConfiguration("full-height-pdf")["monoFontFamily"] !== "") {
        output_mono_font_family = `pre,code {
                    font-family: ${vscode.workspace.getConfiguration("full-height-pdf")["monoFontFamily"]};
        }`;
    }
    await page.addStyleTag({
        content:
            `${output_line_height}
        ${output_general_font_family}
        ${output_mono_font_family}
        `
    });

}

async function openWithEncodingDetect(filepath: string, force_encoding?: string): Promise<string> {
    const filestat = await fs.promises.stat(filepath);
    const filesize = filestat.size;
    const f = await fs.promises.open(filepath, "rs");
    try {
        const read_buf = new Uint8Array(filesize);
        await f.read(read_buf);
        const guess_encoding = jschardet.detect(Buffer.from(read_buf));

        let encoding_name = guess_encoding.encoding;
        if (guess_encoding.encoding === "windows-1252") {
            encoding_name = "shift-jis";
        }
        if (force_encoding) {
            encoding_name = force_encoding;
        }
        const text_decoder = new TextDecoder(encoding_name, { fatal: false });
        const decoded_string = text_decoder.decode(read_buf);
        console.log(decoded_string);
        return decoded_string;
    } finally {
        await f.close();
    }
}

function paperWidth(sizename: string): string | undefined {
    const s = sizename.toLocaleLowerCase();
    switch (s) {
        case "legal":
        case "letter":
            return "215.9mm";
            break;
        case "tabloid":
        case "ledger":
            return "279.4mm";
            break;
        case "a0":
            return "84.1cm";
            break;
        case "a1":
            return "59.4cm";
            break;
        case "a2":
            return "42.0cm";
            break;
        case "a3":
            return "29.7cm";
            break;
        case "a4":
            return "21.0cm";
            break;
        case "a5":
            return "14.8cm";
            break;
        case "a6":
            return "10.5cm";
            break;
        default:
            return "21.0cm";
    }

}


function expanduser(text: string): string {
    if (text.startsWith("~/")) {
        const j = path.join(os.homedir(), text.substring(2));
        return j;
    }
    return text;
}

async function getCorrectHeight(sizename: string, markdowntext: string): Promise<number> {
    const width = paperWidth(sizename);
    const mdtext = convertmd2htmltext(markdowntext);
    const template = `<html><head><title>Calculate Width</title></head><body><div id="container" style="width: ${width}; overflow-y: auto; word-break: break-all;">${mdtext}</div><style></style></body></html>`;
    const text_encoder = new TextEncoder();
    const encoded_string = text_encoder.encode(template);
    const buffer = Buffer.from(encoded_string);
    const launch_option: puppeteer.PuppeteerLaunchOptions = {};
    const executablePath = vscode.workspace.getConfiguration("full-height-pdf")["executablePath"];
    if (executablePath !== "") {
        if (fs.existsSync(executablePath)) {
            launch_option.executablePath = executablePath;
        } else {
            await vscode.window.showWarningMessage("Chrome executable does not exists", { modal: true });
        }
    }
    launch_option.channel = "chrome";
    const browser = await puppeteer.launch(launch_option);
    try {
        const page = await browser.newPage();
        try {
            //page.setDefaultTimeout(0);
            await page.goto(`data:text/html;base64,${buffer.toString("base64")}`, {waitUntil: "domcontentloaded"});
            await addStyle(page);
            const pageHeight = await page.evaluate(() => {
                const container = document.getElementById("container");
                return Math.max(container!!.clientHeight, container!!.scrollHeight);
            });
            return pageHeight;
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

function convertmd2htmltext(text: string): string {
    const md = markdownit().use(kt);
    return md.render(text);
}

async function exportPath(): Promise<string | undefined> {
    let output_path: string = expanduser(vscode.workspace.getConfiguration("full-height-pdf")["exportPath"]);
    try {
        await fs.promises.access(output_path, fs.constants.F_OK);
    } catch (e: any) {
        const selected_uri = await vscode.window.showSaveDialog({ filters: { "PDF": ["pdf"] } });
        if (selected_uri === undefined) {
            return undefined;
        }
        output_path = selected_uri!!.fsPath;
    }
    return output_path;
}

export async function exportPDF(fileUri?: any) {
    let md_text: string;
    if (fileUri === undefined) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            await vscode.window.showWarningMessage("No active editor");
            return;
        }
        /*
        const uri = editor.document.uri;
        const mdfilepath = uri.fsPath;
        if (!fs.existsSync(mdfilepath)) {
            if (editor.document.isUntitled) {
                await vscode.window.showWarningMessage("Please save the file");
                return;
            }
            await vscode.window.showWarningMessage("File does not exists");
            return;
        }
        */
        md_text = editor.document.getText();
    } else {
        try {
            md_text = await openWithEncodingDetect(fileUri.fsPath);
        } catch (e: any) {
            vscode.window.showErrorMessage("Error", { modal: true, detail: e.message });
            return;
        }
        if (!md_text) {
            return;
        }
    }
    const html_text = convertmd2htmltext(md_text);
    let pdf_title = vscode.workspace.getConfiguration("full-height-pdf")["PDFTitle"];
    if (pdf_title === "") {
        pdf_title = "PDF";
    }


    const output_html = `<!DOCTYPE html>
    <html>
        <head>
            <meta charset="utf-8">
            <title>${pdf_title}</title>
        </head>
        <body>${html_text}</body>
    </html>`;
    const text_encoder = new TextEncoder();
    const encoded_string = text_encoder.encode(output_html);
    const buffer = Buffer.from(encoded_string);
    const size = vscode.workspace.getConfiguration("full-height-pdf")["widthFormat"].toLowerCase();
    const launch_option: puppeteer.PuppeteerLaunchOptions = {};
    const executablePath = vscode.workspace.getConfiguration("full-height-pdf")["executablePath"];
    if (executablePath !== "") {
        if (!fs.existsSync(executablePath)) {
            await vscode.window.showWarningMessage("Chrome executable does not exists", { modal: true });
            return;
        }
        launch_option.executablePath = executablePath;
        launch_option.args = ["--no-sandbox", "--disable-setuid-sandbox"];
    }
    launch_option.channel = "chrome";
    const browser = await puppeteer.launch(launch_option);
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    await page.goto(`data:text/html;base64,${buffer.toString("base64")}`);
    addStyle(page);
    const export_path = await exportPath();
    if (export_path === undefined) {
        await vscode.window.showInformationMessage("output path is not specified");
        return;
    }
    let width = paperWidth(size);
    let pageHeight;
    await vscode.window.withProgress({ title: "Exporting PDF...", location: vscode.ProgressLocation.Notification }, async (progress, token) => {
        if (vscode.workspace.getConfiguration("full-height-pdf")["useOriginalWidth"]) {
            pageHeight = await page.evaluate(() => {
                return Math.max(document.documentElement.clientHeight, document.documentElement.scrollHeight, document.body.clientHeight, document.body.scrollHeight);
            });
            const width_value = await page.evaluate(() => {
                return Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth, document.body.clientWidth, document.body.scrollWidth);
            });
            width = width_value.toString() + "px";

        } else {
            pageHeight = await getCorrectHeight(vscode.workspace.getConfiguration("full-height-pdf")["widthFormat"], md_text);
        }

        const pdf_option: puppeteer.PDFOptions = { path: export_path, width: width, height: pageHeight.toString() + "px", margin: { bottom: "1px" }, printBackground: true };
        try {
            await page.pdf(pdf_option);
        } catch (e: any) {
            await vscode.window.showErrorMessage("Error", { modal: true, detail: e.message });
            return;
        }
        await page.close();
        await browser.close();

    });

}