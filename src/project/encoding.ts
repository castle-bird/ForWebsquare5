import { isUtf8 } from 'node:buffer';

const UTF8 = /^utf[_-]?8$/i;
const EUCKR = /^(euc[_-]?kr|cp949|ms949|(x-)?windows-949|ks_c_5601(-1987)?|ksc5601)$/i;
const eucKr = new TextDecoder('euc-kr');
const utf8Decoder = new TextDecoder('utf-8');
/** Node ICU의 TextDecoder('euc-kr')가 KS X 1001(2,350자)만 지원할 때 CP949 확장 완성형(8,822자) 보충 테이블 */
const nativeCp949 = eucKr.decode(new Uint8Array([0x94, 0xEE])) === '뷁';
let uhcHangul: Uint16Array | undefined;

function uhcTable(): Uint16Array {
	if (!uhcHangul) {
		const ks = new Set<number>();
		const pairs = new Uint8Array(25 * 94 * 2);
		for (let b1 = 0xB0, p = 0; b1 <= 0xC8; b1++) {
			for (let b2 = 0xA1; b2 <= 0xFE; b2++) {
				pairs[p++] = b1;
				pairs[p++] = b2;
			}
		}
		for (const ch of eucKr.decode(pairs)) {
			const cp = ch.charCodeAt(0);
			if (cp >= 0xAC00 && cp <= 0xD7A3) { ks.add(cp); }
		}
		const table = new Uint16Array(8822);
		let n = 0;
		for (let cp = 0xAC00; cp <= 0xD7A3; cp++) {
			if (!ks.has(cp)) { table[n++] = cp; }
		}
		uhcHangul = table;
	}
	return uhcHangul;
}

/** CP949(UHC) 확장 완성형 영역(0x81..0xC6) → uhcTable 인덱스. 해당 영역이 아니면 -1 */
function uhcIndex(b1: number, b2: number): number {
	if (b1 < 0x81 || b1 > 0xC6) { return -1; }
	const max2 = b1 <= 0xA0 ? 0xFE : 0xA0;
	if (b2 < 0x41 || b2 > max2 || (b2 > 0x5A && b2 < 0x61) || (b2 > 0x7A && b2 < 0x81)) { return -1; }
	const col = b2 <= 0x5A ? b2 - 0x41 : b2 <= 0x7A ? b2 - 0x61 + 26 : b2 - 0x81 + 52;
	return b1 <= 0xA0 ? (b1 - 0x81) * 178 + col : 32 * 178 + (b1 - 0xA1) * 84 + col;
}

function decodeCp949(bytes: Uint8Array): string {
	if (nativeCp949) {
		return eucKr.decode(bytes);
	}
	let out = '', start = 0;
	for (let i = 0; i < bytes.length;) {
		const b1 = bytes[i];
		if (b1 < 0x80) {
			i++;
			continue;
		}
		if (i + 1 < bytes.length) {
			const b2 = bytes[i + 1];
			if (b1 >= 0xA1 && b1 <= 0xFE && b2 >= 0xA1 && b2 <= 0xFE) {
				i += 2;
				continue;
			}
			const idx = uhcIndex(b1, b2);
			if (idx >= 0) {
				const cp = uhcTable()[idx];
				if (cp) {
					if (i > start) { out += eucKr.decode(bytes.subarray(start, i)); }
					out += String.fromCharCode(cp);
					i += 2;
					start = i;
					continue;
				}
			}
		}
		i++;
	}
	return start === 0 ? eucKr.decode(bytes) : out + eucKr.decode(bytes.subarray(start));
}

/**
 * 화면 XML 바이트를 읽을 VS Code 인코딩 id. XML 선언(없으면 XML 기본값 UTF-8)과 바이트로 정하며 UTF-8·EUC-KR 계열만 다룬다(그 밖은 undefined).
 * 선언이 EUC-KR이어도 UTF-8 BOM이나 3바이트 이상 UTF-8 문자(한글 등)가 든 올바른 UTF-8이면 실제로는 UTF-8로 저장된 파일이라 utf8
 * (2바이트 UTF-8과 겹치는 EUC-KR 한글 '체크' 등을 UTF-8로 오판하지 않게 0xE0 이상만 본다). 선언이 UTF-8인데 바이트가 UTF-8이 아니면 판단하지 않는다
 */
export function xmlEncoding(bytes: Uint8Array): 'utf8' | 'euckr' | undefined {
	const declared = /^(?:\xEF\xBB\xBF)?\s*<\?xml\s[^?]*?encoding\s*=\s*["']([^"']+)["']/
		.exec(Buffer.from(bytes.subarray(0, 200)).toString('latin1'))?.[1]?.trim() ?? 'UTF-8';
	const utf8 = isUtf8(bytes);
	if (EUCKR.test(declared)) {
		return utf8 && bytes.some(b => b >= 0xE0) ? 'utf8' : 'euckr';
	}
	return UTF8.test(declared) && utf8 ? 'utf8' : undefined;
}

/** 디스크의 화면 XML을 문자열로(EUC-KR·CP949 선언 화면도 한글이 깨지지 않게) */
export function decodeXml(bytes: Uint8Array): string {
	return xmlEncoding(bytes) === 'euckr' ? decodeCp949(bytes) : utf8Decoder.decode(bytes);
}
