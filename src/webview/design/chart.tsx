import { createContext, useContext, useEffect, useRef } from 'react';
import { kid, kids, localName, type XmlNode } from '../../core/xmlModel';

/** 화면의 w2:dataCollection: 차트가 ref로 묶인 dataList 값을 읽는다 */
export const DataCollection = createContext<XmlNode | undefined>(undefined);

const PALETTE = ['#5B8FF9', '#5AD8A6', '#F6BD16', '#E8684A', '#6DC8EC', '#9270CA'];
const SAMPLE = { labels: ['A', 'B', 'C', 'D', 'E'], series: [{ name: 'Series', values: [40, 65, 30, 80, 55] }] };

interface Series { name: string; values: number[] }

/** ref="data:dataList1" → 첫 text 컬럼은 x축 이름, number 컬럼은 계열. 없으면 샘플 */
export function chartData(collection: XmlNode | undefined, ref: string | undefined) {
	const id = ref?.replace(/^data:/, '');
	const list = id && collection?.children.find(c => c.attrs.id === id);
	if (!list) { return SAMPLE; }
	const columns = kids(kid(list, 'columnInfo'), 'column');
	const rows = kids(kid(list, 'data'), 'row');
	const value = (row: XmlNode, col: string) => row.children.find(c => localName(c.tag) === col)?.text ?? '';
	const label = columns.find(c => c.attrs.dataType !== 'number');
	const numeric = columns.filter(c => c.attrs.dataType === 'number');
	if (!rows.length || !numeric.length) { return SAMPLE; }
	return {
		labels: rows.map((r, i) => label ? value(r, label.attrs.id) : String(i + 1)),
		series: numeric.map(c => ({ name: c.attrs.name || c.attrs.id, values: rows.map(r => Number(value(r, c.attrs.id)) || 0) })),
	};
}

export function FusionChart({ node }: { node: XmlNode }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const collection = useContext(DataCollection);
	const { chartType = '', plotColor } = node.attrs;
	const data = chartData(collection, node.attrs.ref);
	const colors = plotColor ? plotColor.split(',').map(c => c.trim()) : PALETTE;
	useEffect(() => {
		const canvas = ref.current!;
		const draw = () => {
			const { width, height } = canvas.getBoundingClientRect();
			const dpr = devicePixelRatio || 1;
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			const ctx = canvas.getContext('2d')!;
			ctx.scale(dpr, dpr);
			paint(ctx, width, height, chartType, data.labels, data.series, colors);
		};
		draw();
		const observer = new ResizeObserver(draw);
		observer.observe(canvas);
		return () => observer.disconnect();
	});
	return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, type: string, labels: string[], series: Series[], colors: string[]) {
	const color = (i: number) => colors[i % colors.length];
	ctx.font = '11px sans-serif';
	ctx.clearRect(0, 0, w, h);
	// 범례
	let x = 8;
	series.forEach((s, i) => {
		ctx.fillStyle = color(i);
		ctx.fillRect(x, 8, 10, 10);
		ctx.fillStyle = '#555';
		ctx.fillText(s.name, x + 14, 17);
		x += 24 + ctx.measureText(s.name).width;
	});
	const top = 30;
	if (/pie|doughnut/i.test(type)) {
		const values = series[0].values, total = values.reduce((a, b) => a + b, 0) || 1;
		const r = Math.max(0, Math.min(w, h - top) / 2 - 10), cx = w / 2, cy = top + (h - top) / 2;
		let angle = -Math.PI / 2;
		values.forEach((v, i) => {
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, r, angle, angle += v / total * Math.PI * 2);
			ctx.fillStyle = color(i);
			ctx.fill();
		});
		if (/doughnut/i.test(type)) {
			ctx.beginPath();
			ctx.arc(cx, cy, r / 2, 0, Math.PI * 2);
			ctx.fillStyle = '#fff';
			ctx.fill();
		}
		return;
	}
	const left = 36, bottom = h - 20, right = w - 8;
	const max = Math.max(1, ...series.flatMap(s => s.values));
	const y = (v: number) => bottom - v / max * (bottom - top);
	const step = (right - left) / Math.max(1, labels.length);
	// 축·눈금
	ctx.strokeStyle = '#e5e5e5';
	ctx.fillStyle = '#888';
	ctx.textAlign = 'right';
	for (let i = 0; i <= 4; i++) {
		const v = max * i / 4;
		ctx.beginPath();
		ctx.moveTo(left, y(v));
		ctx.lineTo(right, y(v));
		ctx.stroke();
		ctx.fillText(String(Math.round(v)), left - 4, y(v) + 4);
	}
	ctx.textAlign = 'center';
	labels.forEach((l, i) => ctx.fillText(l, left + step * (i + 0.5), h - 6));
	if (/line|area/i.test(type)) {
		series.forEach((s, si) => {
			ctx.beginPath();
			s.values.forEach((v, i) => ctx.lineTo(left + step * (i + 0.5), y(v)));
			ctx.strokeStyle = ctx.fillStyle = color(si);
			ctx.lineWidth = 2;
			if (/area/i.test(type)) {
				ctx.lineTo(left + step * (s.values.length - 0.5), bottom);
				ctx.lineTo(left + step * 0.5, bottom);
				ctx.globalAlpha = 0.3;
				ctx.fill();
				ctx.globalAlpha = 1;
			} else {
				ctx.stroke();
			}
			ctx.lineWidth = 1;
		});
		return;
	}
	// 기본: 묶은 세로 막대
	const bar = step * 0.7 / series.length;
	series.forEach((s, si) => {
		ctx.fillStyle = color(si);
		s.values.forEach((v, i) => ctx.fillRect(left + step * (i + 0.15) + bar * si, y(v), bar - 1, bottom - y(v)));
	});
}
