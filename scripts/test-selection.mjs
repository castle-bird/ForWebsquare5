/** 파일 이름으로 선택한다. 오타로 전체 검증이 실행되거나 빈 실행이 성공하지 않게 거부한다. */
export function selectTests(args, available) {
	const list = args.includes('--list');
	const names = [...new Set(args.filter(arg => arg !== '--list'))];
	for (const name of names) {
		if (!available.includes(name)) { throw new Error(`알 수 없는 테스트: ${name}. 사용 가능: ${available.join(', ')}`); }
	}
	return { list, names: names.length ? names : available };
}
