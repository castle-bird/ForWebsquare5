// 여러 테스트 파일이 같이 쓰는 도우미·예제 XML

/** ok가 참이 될 때까지 최대 5초 기다리고 마지막 결과를 돌려준다 */
export async function waitFor(ok: () => boolean): Promise<boolean> {
	for (let i = 0; i < 50 && !ok(); i++) {
		await new Promise(r => setTimeout(r, 100));
	}
	return ok();
}

export const SCREEN = `<?xml version="1.0" encoding="UTF-8"?>
<!-- <fake/> -->
<html xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">
	<head>
		<w2:dataCollection><w2:dataMap id="dma_a"/></w2:dataCollection>
		<script type="text/javascript"><![CDATA[ if (a < b) { scwin.x = "<tag>"; } ]]></script>
	</head>
	<body>
		<xf:group id="grp_main" style="width:100%" title="a &lt; b">
			<w2:textbox id="tbx_title" label="한글"/>
		</xf:group>
	</body>
</html>`;

export const DEFS = `<?xml version="1.0" encoding="UTF-8"?>
<WebSquare><components>
	<component id="textbox" namespaceURI="http://www.inswave.com/websquare" realType="textbox" display="TextBox">
		<properties>
			<property name="label" maincategory="Basic &amp; ETC" maincategoryorder="1" description="표시 문구"/>
			<property name="style" maincategory="Style" maincategoryorder="2" description=""/>
			<property name="tagname" maincategory="Style" maincategoryorder="2" type="combobox"><option name="span" value="span"/><option name="p" value="p"/></property>
			<property name="disabled" maincategory="Style" maincategoryorder="2" type="[true, false]"/>
		</properties>
		<events><event name="onclick(e)" description="클릭"/></events>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column" display="NULL">
		<parents><parent id="columnInfo"/></parents><baseComponents><base id="dataList"/></baseComponents>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column">
		<parents><parent id="row"/></parents><baseComponents><base id="gridView"/></baseComponents>
	</component>
	<component id="column" namespaceURI="http://www.inswave.com/websquare" realType="column">
		<parents><parent id="row"/></parents><baseComponents><base id="grid"/></baseComponents>
	</component>
	<component id="select1" namespaceURI="http://www.w3.org/2002/xforms" realType="radio"/>
	<component id="select1" namespaceURI="http://www.w3.org/2002/xforms" realType="selectbox"/>
</components></WebSquare>`;
