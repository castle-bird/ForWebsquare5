import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseXml, type XmlNode } from '../../core/xmlModel';
import { paletteKey } from '../../core/palette';
import type { ComponentDef } from '../../core/protocol';
import { insertFromPalette, paletteFavorites, savePaletteFavorite, reorderPaletteFavorites } from '../../vscode/palette';

suite('palette (VS Code)', () => {
	const W2 = 'http://www.inswave.com/websquare', XF = 'http://www.w3.org/2002/xforms';
	const def = (id: string, realType: string, ns = W2, extra: Partial<ComponentDef> = {}): ComponentDef =>
		({ id, ns, realType, display: realType, category: 'Forms', parents: [], bases: [], properties: [], events: [], ...extra });
	const screen = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:w2="${W2}" xmlns:xf="${XF}">\n<head><xf:model/></head>\n<body>\n\t<xf:group id="grp">\n\t\t<xf:input id="input1"/>\n\t</xf:group>\n\t<w2:gridView id="grd"><w2:gBody id="b"><w2:row id="r"><w2:column id="c"/></w2:row></w2:gBody></w2:gridView>\n</body>\n</html>`;
	const find = (root: XmlNode, id: string): XmlNode => root.attrs.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)!;

	test('즐겨찾기: 같은 select1의 종류·설치본 구분, 전역 저장·중복·동시 변경', async () => {
		const values = new Map<string, unknown>();
		const state: vscode.Memento = { keys: () => [...values.keys()], get: <T>(key: string, fallback?: T) => (values.get(key) as T) ?? fallback!, update: async (key, value) => { await Promise.resolve(); values.set(key, value); } };
		const radio = def('select1', 'radio', 'urn:favorite-test'), select = def('select1', 'selectbox', 'urn:favorite-test');
		const rk = paletteKey(radio), sk = paletteKey(select);
		assert.notStrictEqual(rk, sk);
		assert.notStrictEqual(rk, paletteKey({ ...radio, ns: 'urn:other-install' }));
		const before = paletteFavorites(state);
		try {
			await Promise.all([savePaletteFavorite(state, radio, true), savePaletteFavorite(state, select, true), savePaletteFavorite(state, radio, true)]);
			assert.strictEqual(paletteFavorites(state).filter(k => k === rk).length, 1);
			assert.ok(paletteFavorites(state).includes(sk));
			await reorderPaletteFavorites(state, [sk, sk, 'unknown']);
			assert.deepStrictEqual(paletteFavorites(state), [sk, rk], '순서만 바꾸고 중복·모르는 항목은 제외, 누락 항목 유지');
			await Promise.all([reorderPaletteFavorites(state, [rk, sk]), savePaletteFavorite(state, select, false)]);
			assert.deepStrictEqual(paletteFavorites(state), [rk], '정렬 중 해제한 항목을 복구하지 않는다');
			await savePaletteFavorite(state, select, true);
			await savePaletteFavorite(state, radio, false);
			assert.ok(!paletteFavorites(state).includes(rk));
			assert.ok(paletteFavorites(state).includes(sk), '한 항목을 지워도 다른 즐겨찾기는 남는다');
		} finally {
			await savePaletteFavorite(state, radio, before.includes(rk));
			await savePaletteFavorite(state, select, before.includes(sk));
		}
	});

	test('웹뷰 삽입: 지정한 자리·고유 id·오래된 버전·잘못된 대상·불가능한 자리', async () => {
		for (const position of ['first', 'inside', 'before', 'after'] as const) {
			const doc = await vscode.workspace.openTextDocument({ content: screen, language: 'xml' });
			const root = parseXml(doc.getText())!, grp = find(root, 'grp');
			const id = await insertFromPalette(doc, def('input', 'input', XF), grp.index, undefined, position, doc.version);
			assert.strictEqual(id, 'input2');
			const next = parseXml(doc.getText())!, added = find(next, id!), group = find(next, 'grp');
			assert.ok(position === 'first' ? group.children[0] === added : position === 'inside' ? group.children.at(-1) === added
				: position === 'before' ? added.end <= group.start : group.end <= added.start);
			const text = doc.getText();
			assert.strictEqual(await insertFromPalette(doc, def('input', 'input', XF), group.index, undefined, 'inside', doc.version - 1), undefined);
			assert.strictEqual(await insertFromPalette(doc, def('input', 'input', XF), 99999, undefined, 'inside'), undefined);
			assert.strictEqual(await insertFromPalette(doc, def('input', 'input', XF), next.children[1].index, undefined, 'before'), undefined);
			assert.strictEqual(doc.getText(), text, '잘못된 요청은 XML을 바꾸지 않는다');
		}
	});
});
