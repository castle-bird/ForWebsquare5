// 끄는 중 포인터가 스크롤 칸 가장자리에 머물면 굴리는 양(Design 그리드 칸 고르기, 칸 편집 표, 행 끌기)

/**
 * 한 축의 한 프레임 굴릴 양. before: 앞쪽(위·왼쪽) 가장자리 띠를 넘어선 거리, after: 뒤쪽(아래·오른쪽) 띠를 넘어선 거리.
 * 멀수록 빠르게(per px마다 1px, 최대 max px), 둘 다 안 넘으면 0
 */
export const edgeSpeed = (before: number, after: number, max = 16, per = 5) =>
	before > 0 ? -Math.min(max, Math.ceil(before / per)) : after > 0 ? Math.min(max, Math.ceil(after / per)) : 0;
