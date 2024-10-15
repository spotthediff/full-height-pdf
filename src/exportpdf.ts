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
    if (css_path !== "" && fs.existsSync(css_path) && fs.lstatSync(css_path).isFile()) {
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
        return text_decoder.decode(read_buf);
    } finally {
        await f.close();
    }
}

function paperWidth(sizename: string): string {
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

async function calculatePageHeight(sizename: string, markdowntext: string): Promise<number> {
    const width = paperWidth(sizename);
    const mdtext = convertmd2htmltext(markdowntext);
    // Render all content in the container that has fixed width  

    const template = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Calculate Width</title></head><body><div id="container">${mdtext}</div></body></html>`;

    const text_encoder = new TextEncoder();
    const encoded_string = text_encoder.encode(template);
    const buffer = Buffer.from(encoded_string);
    const launch_option: puppeteer.PuppeteerLaunchOptions = {};
    launch_option.channel = "chrome";
    //launch_option.headless = false;
    const browser = await puppeteer.launch(launch_option);
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(0);
        await page.goto(`data:text/html;base64,${buffer.toString("base64")}`/*, { waitUntil: "domcontentloaded" }*/);
        await page.addStyleTag({
            content: `
                div#container {
                width: ${width};
                }`});
        await addStyle(page);
        const pageHeight = await page.evaluate(() => {
            const container = document.getElementById("container");
            return Math.max(container!!.clientHeight, container!!.scrollHeight); // get Tallest Height in the container Height
        });
        return pageHeight;
    } finally {
        await browser.close();
    }
}

function convertmd2htmltext(text: string): string {
    const md = markdownit().use(kt);
    return md.render(text);
}

async function exportPath(): Promise<string> {
    const selected_uri = await vscode.window.showSaveDialog({ filters: { "PDF": ["pdf"] } });
    if (selected_uri === undefined) {
        return "";
    }
    const output_path = selected_uri!!.fsPath;
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
    //const size = vscode.workspace.getConfiguration("full-height-pdf")["widthFormat"].toLowerCase();
    const launch_option: puppeteer.PuppeteerLaunchOptions = {};
    launch_option.args = ["--no-sandbox", "--disable-setuid-sandbox"];
    launch_option.channel = "chrome";
    launch_option.headless = true;
    const executablePath = vscode.workspace.getConfiguration("full-height-pdf")["executablePath"];
    if (executablePath !== "") {
        if (!fs.existsSync(executablePath)) {
            await vscode.window.showWarningMessage("Chrome executable does not exists", { modal: true });
            return;
        }
        launch_option.executablePath = executablePath;
    }
    const export_path = await exportPath();
    if (export_path === "") {
        await vscode.window.showInformationMessage("output path is not specified");
        console.log("exported_path is blank string");
        return;
    }
    const browser = await puppeteer.launch(launch_option);
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(0);
        await page.goto(`data:text/html;base64,${buffer.toString("base64")}`);
        await addStyle(page);
        //const export_path = await exportPath();
        console.log(export_path);
        let width;
        let pageHeight;
        await vscode.window.withProgress({ title: "Exporting PDF...", location: vscode.ProgressLocation.Notification }, async (progress, token) => {
            pageHeight = await page.evaluate(() => {
                return Math.max(document.documentElement.clientHeight, document.documentElement.scrollHeight, document.body.clientHeight, document.body.scrollHeight);
            });
            const width_value = await page.evaluate(() => {
                return Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth, document.body.clientWidth, document.body.scrollWidth);
            });
            width = width_value.toString() + "px";
            const pdf_option: puppeteer.PDFOptions = { path: export_path, width: width, height: pageHeight.toString() + "px", margin: { bottom: "1px" }, printBackground: true };
            try {
                await page.pdf(pdf_option);
            } catch (e: any) {
                await vscode.window.showErrorMessage("Error", { modal: true, detail: e.message });
                return;
            }
        });
    } finally {
        browser.close();
        console.log("Close");
    }

}