import * as vscode from 'vscode';
import type { ComponentDef } from '../core/protocol';
import type { InsertPosition } from '../core/paste';
import { insertComponent, insertPositions, insertTarget, paletteKey, INSERT_POSITION_LABELS } from '../core/palette';
import { parseXml, pathTo } from '../core/xmlModel';
import { errorMessage } from '../core/errors';
import { loadDefaultStyles } from '../project/components';
import { resolvePath } from './setup';
import { applyTextEdits } from './documentEdit';
import { serial } from '../project/paths';

const FAVORITES = 'websquare5-editor.paletteFavorites';
const favoriteQueue = new Map<string, Promise<unknown>>();

export const paletteFavorites = (globalState: vscode.Memento): string[] => globalState.get<string[]>(FAVORITES) ?? [];

/** 화면 여럿에서 눌러도 저장 결과가 서로 덮이지 않게 순서대로 반영한다. */
export const savePaletteFavorite = (globalState: vscode.Memento, component: Pick<ComponentDef, 'id' | 'ns' | 'realType'>, favorite: boolean) => serial(favoriteQueue, FAVORITES, async () => {
	const key = paletteKey(component), current = paletteFavorites(globalState);
	const keys = favorite ? [...new Set([...current, key])] : current.filter(k => k !== key);
	await globalState.update(FAVORITES, keys);
});

/** 저장 중 추가된 항목은 유지하며, 순서 변경만 반영한다. */
export const reorderPaletteFavorites = (globalState: vscode.Memento, order: string[]) => serial(favoriteQueue, FAVORITES, async () => {
	const current = paletteFavorites(globalState);
	await globalState.update(FAVORITES, [...new Set([...order.filter(key => current.includes(key)), ...current])]);
});

let lastPosition: InsertPosition = 'inside';

export async function insertFromPalette(document: vscode.TextDocument, def: ComponentDef, selected: number | undefined, webRoot?: string, position?: InsertPosition, expectedVersion = document.version): Promise<string | undefined> {
	const version = expectedVersion;
	if (document.version !== version) { return undefined; }
	const text = document.getText();
	const root = parseXml(text);
	const path = root && selected !== undefined ? pathTo(root, selected) : undefined;
	if (selected !== undefined && !path) { return undefined; }
	const target = root && insertTarget(root, path);
	if (!root || !target) {
		void vscode.window.showWarningMessage('body가 없는 화면이라 넣을 수 없습니다.');
		return undefined;
	}
	const positions = insertPositions(target);
	const name = def.display ?? def.id;
	const picked = position === undefined ? await vscode.window.showQuickPick(
		[...positions].sort((a, b) => Number(b === lastPosition) - Number(a === lastPosition)).map(position => ({ label: INSERT_POSITION_LABELS[position], position })),
		{ title: `${name} 넣기`, placeHolder: `${target.tag}${target.attrs.id ? ` #${target.attrs.id}` : ''} 기준` }) : positions.includes(position) ? { position } : undefined;
	if (!picked) {
		return undefined;
	}
	if (position === undefined) { lastPosition = picked.position; }
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
