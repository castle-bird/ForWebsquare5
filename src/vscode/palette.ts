import * as vscode from 'vscode';
import type { ComponentDef } from '../core/protocol';
import type { InsertPosition } from '../core/paste';
import { insertComponent, insertPositions, insertTarget, matchPalette, paletteDefs } from '../core/palette';
import { COMPONENT_ICONS } from '../core/icons';
import { parseXml, pathTo } from '../core/xmlModel';
import { errorMessage } from '../core/errors';
import { loadDefaultStyles } from '../project/components';
import { resolvePath } from './setup';
import { applyTextEdits } from './documentEdit';

const PALETTE_VIEW = 'websquare5-editor.palette';
const INSERT_COMMAND = 'websquare5-editor.insertComponent';
const SEARCH_COMMAND = 'websquare5-editor.searchPalette';
const CLEAR_COMMAND = 'websquare5-editor.clearPaletteSearch';
const FILTER_KEY = 'websquare5-editor.paletteFiltered';

export interface PaletteTarget {
	defs(): Promise<ComponentDef[]>;
	insert(def: ComponentDef): Promise<void>;
}

type Item = string | ComponentDef;

class PaletteTree implements vscode.TreeDataProvider<Item> {
	target?: PaletteTarget;
	filter = '';
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	setTarget(target: PaletteTarget | undefined) {
		if (target !== this.target) {
			this.target = target;
			this.changed.fire();
		}
	}

	setFilter(filter: string) {
		this.filter = filter.trim();
		void vscode.commands.executeCommand('setContext', FILTER_KEY, !!this.filter);
		this.changed.fire();
	}

	refresh() {
		this.changed.fire();
	}

	async getChildren(item?: Item): Promise<Item[]> {
		const defs = matchPalette(paletteDefs(await this.target?.defs().catch(() => []) ?? []), this.filter);
		if (item === undefined) {
			return [...new Set(defs.map(d => d.category!))].sort();
		}
		return typeof item === 'string' ? defs.filter(d => d.category === item).sort((a, b) => a.display!.localeCompare(b.display!)) : [];
	}

	getTreeItem(item: Item): vscode.TreeItem {
		if (typeof item === 'string') {
			// 검색 중에는 펼쳐 보인다(id를 바꿔야 VS Code가 접힘 상태를 새로 정한다)
			return Object.assign(new vscode.TreeItem(item, this.filter ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed), { id: `category:${item}:${!!this.filter}` });
		}
		return Object.assign(new vscode.TreeItem(item.display!), {
			iconPath: new vscode.ThemeIcon(COMPONENT_ICONS[item.realType] ?? 'symbol-misc'),
			tooltip: item.description,
			command: { command: INSERT_COMMAND, title: '넣기', arguments: [item] },
		});
	}
}

const tree = new PaletteTree();

export function registerPalette(context: vscode.ExtensionContext) {
	const view = vscode.window.createTreeView(PALETTE_VIEW, { treeDataProvider: tree });
	context.subscriptions.push(
		view,
		vscode.commands.registerCommand(SEARCH_COMMAND, async () => {
			const filter = await vscode.window.showInputBox({ title: '컴포넌트 검색', value: tree.filter, placeHolder: '이름·태그·묶음 (예: select, 그리드)' });
			if (filter !== undefined) {
				tree.setFilter(filter);
				view.description = tree.filter ? `검색: ${tree.filter}` : undefined;
			}
		}),
		vscode.commands.registerCommand(CLEAR_COMMAND, () => {
			tree.setFilter('');
			view.description = undefined;
		}),
		vscode.commands.registerCommand(INSERT_COMMAND, (def: ComponentDef) => tree.target?.insert(def)),
	);
}

export const setPaletteTarget = (target: PaletteTarget) => tree.setTarget(target);
export const refreshPalette = () => tree.refresh();
export const hasPaletteTarget = () => !!tree.target;
export function releasePaletteTarget(target: PaletteTarget) {
	if (tree.target === target) {
		tree.setTarget(undefined);
	}
}

const LABELS: Record<InsertPosition, string> = { first: '안쪽 맨 앞', inside: '안쪽 맨 뒤', before: '앞에', after: '뒤에' };
let lastPosition: InsertPosition = 'inside';

export async function insertFromPalette(document: vscode.TextDocument, def: ComponentDef, selected: number | undefined, webRoot?: string): Promise<string | undefined> {
	const version = document.version;
	const text = document.getText();
	const root = parseXml(text);
	const target = root && insertTarget(root, selected === undefined ? undefined : pathTo(root, selected));
	if (!root || !target) {
		void vscode.window.showWarningMessage('body가 없는 화면이라 넣을 수 없습니다.');
		return undefined;
	}
	const positions = insertPositions(target);
	const name = def.display ?? def.id;
	const picked = await vscode.window.showQuickPick(
		[...positions].sort((a, b) => Number(b === lastPosition) - Number(a === lastPosition)).map(position => ({ label: LABELS[position], position })),
		{ title: `${name} 넣기`, placeHolder: `${target.tag}${target.attrs.id ? ` #${target.attrs.id}` : ''} 기준` });
	if (!picked) {
		return undefined;
	}
	lastPosition = picked.position;
	const source = await resolvePath('componentDefinitionFile', document.uri, webRoot);
	const sizes = source ? await loadDefaultStyles(source) : undefined;
	if (document.version !== version) {
		void vscode.window.showWarningMessage('고르는 사이 문서가 바뀌었습니다. 다시 눌러 주세요.');
		return undefined;
	}
	try {
		const { edit, id } = insertComponent(text, root, target, picked.position, def, sizes?.get(def.realType));
		return await applyTextEdits(document, [edit]) ? id : undefined;
	} catch (e) {
		void vscode.window.showErrorMessage(`${name} 넣기 실패: ${errorMessage(e)}`);
		return undefined;
	}
}
