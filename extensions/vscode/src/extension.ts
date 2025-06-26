import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

interface FileData {
  filename: string
  content: string
  isCompressed: boolean
}

interface WebviewData {
  type: `trajectory` | `structure`
  data: FileData
}

interface MessageData {
  command: string
  text?: string
  filename?: string
  content?: string
}

// Check if filename indicates a trajectory file
export function is_trajectory_file(filename: string): boolean {
  const name = filename.toLowerCase()
  return (
    name.match(/\.(traj|xyz|extxyz|h5|hdf5)$/) !== null ||
    /(xdatcar|trajectory|traj|md|relax)/.test(name) ||
    /\.(xyz|extxyz|traj)\.gz$/.test(name) ||
    (name.endsWith(`.gz`) && /(traj|xdatcar|trajectory|relax|xyz)/.test(name))
  )
}

// Read file from filesystem
export const read_file = (file_path: string): FileData => {
  const filename = path.basename(file_path)
  const compressed = /\.(gz|traj|h5|hdf5)$/.test(filename)
  return {
    filename,
    content: compressed
      ? fs.readFileSync(file_path).toString(`base64`)
      : fs.readFileSync(file_path, `utf8`),
    isCompressed: compressed,
  }
}

// Get file data from URI or active editor
export const get_file = (uri?: vscode.Uri): FileData => {
  if (uri) return read_file(uri.fsPath)

  if (vscode.window.activeTextEditor) {
    return {
      filename: path.basename(vscode.window.activeTextEditor.document.fileName),
      content: vscode.window.activeTextEditor.document.getText(),
      isCompressed: false,
    }
  }

  const active_tab = vscode.window.tabGroups.activeTabGroup.activeTab
  if (
    active_tab?.input && typeof active_tab.input === `object` &&
    active_tab.input !== null && `uri` in active_tab.input
  ) {
    return read_file((active_tab.input as { uri: vscode.Uri }).uri.fsPath)
  }

  throw new Error(`No file found`)
}

// Create HTML content for webview
export const create_html = (
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  data: WebviewData,
): string => {
  const nonce = Math.random().toString(36).slice(2, 34)
  const css_uri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, `dist`, `webview.css`),
  )
  const js_uri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, `dist`, `webview.js`),
  )

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${css_uri}">
    <script nonce="${nonce}">window.mattervizData=${JSON.stringify(data)}</script>
  </head>
  <body>
    <div id="matterviz-app"></div>
    <script nonce="${nonce}" src="${js_uri}"></script>
    <script nonce="${nonce}">
      window.initializeMatterViz?.();
    </script>
  </body>
</html>`
}

// Handle messages from webview
export const handle_msg = async (msg: MessageData): Promise<void> => {
  if (msg.command === `info` && msg.text) {
    vscode.window.showInformationMessage(msg.text)
  } else if (msg.command === `error` && msg.text) {
    vscode.window.showErrorMessage(msg.text)
  } else if (msg.command === `saveAs` && msg.content) {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(msg.filename || `structure`),
        filters: { 'Files': [`*`] },
      })

      if (uri && msg.content) {
        fs.writeFileSync(uri.fsPath, msg.content, `utf8`)
        vscode.window.showInformationMessage(
          `Saved: ${path.basename(uri.fsPath)}`,
        )
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Save failed: ${message}`)
    }
  }
}

// Render structure or trajectory in webview
export const render = (context: vscode.ExtensionContext, uri?: vscode.Uri) => {
  try {
    const file = get_file(uri)
    const panel = vscode.window.createWebviewPanel(
      `matterviz`,
      `MatterViz - ${file.filename}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, `dist`)],
      },
    )
    panel.webview.html = create_html(panel.webview, context, {
      type: is_trajectory_file(file.filename) ? `trajectory` : `structure`,
      data: file,
    })
    panel.webview.onDidReceiveMessage(
      handle_msg,
      undefined,
      context.subscriptions,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed: ${message}`)
  }
}

// Custom editor provider for MatterViz files
class Provider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  constructor(private context: vscode.ExtensionContext) {}

  openCustomDocument(
    uri: vscode.Uri,
    _open_context: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): vscode.CustomDocument {
    return {
      uri,
      dispose: () => {},
    }
  }

  resolveCustomEditor(
    document: vscode.CustomDocument,
    webview_panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ) {
    try {
      const filename = path.basename(document.uri.fsPath)
      webview_panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, `dist`),
        ],
      }
      webview_panel.webview.html = create_html(
        webview_panel.webview,
        this.context,
        {
          type: is_trajectory_file(filename) ? `trajectory` : `structure`,
          data: read_file(document.uri.fsPath),
        },
      )
      webview_panel.webview.onDidReceiveMessage(
        handle_msg,
        undefined,
        this.context.subscriptions,
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed: ${message}`)
    }
  }
}

// Activate extension
export const activate = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `matterviz.renderStructure`,
      (uri?: vscode.Uri) => render(context, uri),
    ),
    vscode.window.registerCustomEditorProvider(
      `matterviz.viewer`,
      new Provider(context),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  )
}

// Deactivate extension
export const deactivate = (): void => {}
