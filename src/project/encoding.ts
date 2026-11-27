import { isUtf8 } from 'node:buffer';

const UTF8 = /^utf-?8$/i;
const EUCKR = /^(euc-?kr|cp949|ms949|(x-)?windows-949|ks_c_5601(-1987)?|ksc5601)$/i;

/**
 * 화면 XML 바이트를 읽을 VS Code 인코딩 id. XML 선언(없으면 XML 기본값 UTF-8)과 바이트로 정하며 UTF-8·EUC-KR 계열만 다룬다(그 밖은 undefined).
 * 선언이 EUC-KR이어도 한글이 든 올바른 UTF-8이면 실제로는 UTF-8로 저장된 파일이라 utf8. 선언이 UTF-8인데 바이트가 UTF-8이 아니면 판단하지 않는다
 */
export function xmlEncoding(bytes: Uint8Array): 'utf8' | 'euckr' | undefined {
	const declared = /^(?:﻿|\xEF\xBB\xBF)?\s*<\?xml\s[^?]*?encoding\s*=\s*["']([^"']+)["']/.exec(Buffer.from(bytes.subarray(0, 200)).toString('latin1'))?.[1] ?? 'UTF-8';
	const utf8 = isUtf8(bytes);
	if (EUCKR.test(declared)) {
		return utf8 && bytes.some(b => b >= 0x80) ? 'utf8' : 'euckr';
	}
	return UTF8.test(declared) && utf8 ? 'utf8' : undefined;
}

/** 디스크의 화면 XML을 문자열로(EUC-KR 선언 화면도 한글이 깨지지 않게) */
export function decodeXml(bytes: Uint8Array): string {
	return new TextDecoder(xmlEncoding(bytes) === 'euckr' ? 'euc-kr' : 'utf-8').decode(bytes);
}
