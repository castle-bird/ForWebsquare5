import * as vscode from 'vscode';
import { errorMessage } from '../core/errors';

const EMPTY_SCREEN = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
    xmlns:ev="http://www.w3.org/2001/xml-events"
    xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">
    <head>
        <w2:type>COMPONENT</w2:type>
        <w2:buildDate />
        <w2:MSA />
        <xf:model>
            <w2:dataCollection baseNode="map" />
            <w2:workflowCollection />
        </xf:model>
        <w2:layoutInfo />
        <w2:publicInfo method="" />
        <script lazy="false" type="text/javascript"><![CDATA[
scwin.onpageload = function() {
\t
};
]]></script>
    </head>
    <body ev:onpageload="scwin.onpageload" />
</html>
`;

export async function createScreen(folder?: vscode.Uri): Promise<void> {
	if (!vscode.workspace.isTrusted) { return; }
	try {
		const base = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
		const chosen = await vscode.window.showSaveDialog({
			title: 'New Websquare5 File...',
			defaultUri: base && vscode.Uri.joinPath(base, 'new-screen.xml'),
			filters: { 'WebSquare5 XML': ['xml'] },
		});
		if (!chosen) { return; }
		const uri = /\.xml$/i.test(chosen.path) ? chosen : chosen.with({ path: chosen.path + '.xml' });
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
		edit.insert(uri, new vscode.Position(0, 0), EMPTY_SCREEN);
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error('파일을 만들지 못했습니다. 같은 이름의 파일이 있는지 확인해 주세요.');
		}
		await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
	} catch (e) {
		void vscode.window.showErrorMessage(`WebSquare5 파일 생성 실패: ${errorMessage(e)}`);
	}
}
