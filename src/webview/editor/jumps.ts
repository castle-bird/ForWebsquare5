// 정의로 이동(같은 편집기 안)을 마우스 뒤로·앞으로 기록에 알린다. 기록은 main.tsx useTabHistory가 갖고, 편집기는 자리를 되돌리는 함수만 준다
type Restore = () => void;
let listener: ((from: Restore, to: Restore) => void) | undefined;

/** 기록하는 쪽이 하나 등록한다. 해제 함수를 돌려준다 */
export const onJump = (fn: (from: Restore, to: Restore) => void) => {
	listener = fn;
	return () => { if (listener === fn) { listener = undefined; } };
};

/** 편집기 안에서 from 자리 → to 자리로 옮겼다 */
export const jumped = (from: Restore, to: Restore) => listener?.(from, to);
