# -*- coding: utf-8 -*-
"""生成《大数据安全治理与服务保障平台 用户操作手册（普通用户版）》DOCX。

数据与图片全部来自项目 README 与 docs/screenshots/，面向业务用户，不涉及安装部署细节。
"""
import os
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = os.path.join(ROOT, 'docs', 'screenshots')
OUT = os.path.join(ROOT, 'docs', '用户操作手册.docx')

INK = RGBColor(0x1F, 0x3A, 0x5F)
ACCENT = RGBColor(0x1F, 0x6F, 0xEB)
BODY = RGBColor(0x2B, 0x35, 0x45)
GREY = RGBColor(0x6B, 0x77, 0x88)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
HEADER_FILL = '1F3A5F'
ZEBRA = 'F4F7FC'
CALLOUT_FILL = 'EAF2FE'
BAND_FILL = 'EAF2FE'

FIG = {'ch': 0, 'n': 0}


# --------------------------------------------------------------------------- 基础样式
def set_style_font(style, name='宋体', size=10.5, bold=False, color=BODY):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = color
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), name)
    rfonts.set(qn('w:ascii'), 'Segoe UI' if name == '微软雅黑' else 'Times New Roman')
    rfonts.set(qn('w:hAnsi'), 'Segoe UI' if name == '微软雅黑' else 'Times New Roman')


def set_run_font(run, name='宋体', size=10.5, bold=False, color=BODY, italic=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), name)
    rfonts.set(qn('w:ascii'), 'Segoe UI' if name == '微软雅黑' else 'Times New Roman')
    rfonts.set(qn('w:hAnsi'), 'Segoe UI' if name == '微软雅黑' else 'Times New Roman')


def shade(cell, color):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), color)
    tcpr.append(shd)


def cell_margins(table, top=60, bottom=60, left=100, right=100):
    tblpr = table._tbl.tblPr
    mar = OxmlElement('w:tblCellMar')
    for tag, val in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        el = OxmlElement(f'w:{tag}')
        el.set(qn('w:w'), str(val))
        el.set(qn('w:type'), 'dxa')
        mar.append(el)
    tblpr.append(mar)


def table_borders(table, color='C9D6E8', sz=4):
    tblpr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), str(sz))
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), color)
        borders.append(el)
    tblpr.append(borders)


def para_border(p, color='1F6FEB', sz=10, pos='bottom', space=6):
    ppr = p._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    el = OxmlElement(f'w:{pos}')
    el.set(qn('w:val'), 'single')
    el.set(qn('w:sz'), str(sz))
    el.set(qn('w:space'), str(space))
    el.set(qn('w:color'), color)
    pbdr.append(el)
    ppr.append(pbdr)


def add_field(paragraph, instr, placeholder='1'):
    run = paragraph.add_run()
    for kind, payload in (('begin', None), ('instr', instr), ('separate', None), ('text', placeholder), ('end', None)):
        if kind == 'begin':
            el = OxmlElement('w:fldChar')
            el.set(qn('w:fldCharType'), 'begin')
        elif kind == 'instr':
            el = OxmlElement('w:instrText')
            el.set(qn('xml:space'), 'preserve')
            el.text = payload
        elif kind == 'separate':
            el = OxmlElement('w:fldChar')
            el.set(qn('w:fldCharType'), 'separate')
        elif kind == 'text':
            el = OxmlElement('w:t')
            el.text = payload
        else:
            el = OxmlElement('w:fldChar')
            el.set(qn('w:fldCharType'), 'end')
        run._r.append(el)
    return run


# --------------------------------------------------------------------------- 文档骨架
def build_document():
    doc = Document()

    # 页面：A4，左右 2.2cm，上下 2.4cm
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.4)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)
    section.header_distance = Cm(1.2)
    section.footer_distance = Cm(1.0)

    normal = doc.styles['Normal']
    set_style_font(normal, '宋体', 10.5)
    normal.paragraph_format.line_spacing = 1.55
    normal.paragraph_format.space_after = Pt(5)

    h1 = doc.styles['Heading 1']
    set_style_font(h1, '微软雅黑', 19, True, INK)
    h1.paragraph_format.space_before = Pt(6)
    h1.paragraph_format.space_after = Pt(4)
    h1.paragraph_format.line_spacing = 1.15

    h2 = doc.styles['Heading 2']
    set_style_font(h2, '微软雅黑', 14, True, ACCENT)
    h2.paragraph_format.space_before = Pt(14)
    h2.paragraph_format.space_after = Pt(4)
    h2.paragraph_format.line_spacing = 1.2

    h3 = doc.styles['Heading 3']
    set_style_font(h3, '微软雅黑', 12, True, INK)
    h3.paragraph_format.space_before = Pt(10)
    h3.paragraph_format.space_after = Pt(3)
    h3.paragraph_format.line_spacing = 1.2

    for name in ('List Bullet', 'List Number'):
        st = doc.styles[name]
        set_style_font(st, '宋体', 10.5)
        st.paragraph_format.line_spacing = 1.5
        st.paragraph_format.space_after = Pt(2)

    # 页眉页脚
    header = section.header
    hp = header.paragraphs[0]
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(16.6), WD_TAB_ALIGNMENT.RIGHT)
    r1 = hp.add_run('大数据安全治理与服务保障平台')
    set_run_font(r1, '微软雅黑', 8.5, False, GREY)
    hp.add_run('\t')
    r2 = hp.add_run('用户操作手册（普通用户版）')
    set_run_font(r2, '微软雅黑', 8.5, False, GREY)
    para_border(hp, 'C9D6E8', 6, 'bottom', 4)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run('第 ')
    set_run_font(r, '宋体', 9, False, GREY)
    add_field(fp, 'PAGE')
    r = fp.add_run(' 页 / 共 ')
    set_run_font(r, '宋体', 9, False, GREY)
    add_field(fp, 'NUMPAGES', '1')
    r = fp.add_run(' 页')
    set_run_font(r, '宋体', 9, False, GREY)
    for run in fp.runs:
        set_run_font(run, '宋体', 9, False, GREY)

    # 文档属性
    props = doc.core_properties
    props.title = '大数据安全治理与服务保障平台 用户操作手册（普通用户版）'
    props.subject = '平台业务流程与功能说明'
    props.author = '数据安全平台项目组'
    props.comments = '依据项目 README 与交付截图编制，面向平台业务用户。'
    return doc


# --------------------------------------------------------------------------- 复合组件
def h1(doc, text, page_break=True):
    p = doc.add_heading(level=1)
    if page_break:
        p.paragraph_format.page_break_before = True
    run = p.add_run(text)
    set_run_font(run, '微软雅黑', 19, True, INK)
    para_border(p, '1F6FEB', 10, 'bottom', 6)
    return p


def h2(doc, text):
    p = doc.add_heading(level=2)
    run = p.add_run(text)
    set_run_font(run, '微软雅黑', 14, True, ACCENT)
    return p


def h3(doc, text):
    p = doc.add_heading(level=3)
    run = p.add_run(text)
    set_run_font(run, '微软雅黑', 12, True, INK)
    return p


def body(doc, text, indent=True, size=10.5, color=BODY, space_after=5):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = 1.55
    p.paragraph_format.space_after = Pt(space_after)
    if indent:
        p.paragraph_format.first_line_indent = Pt(size * 2)
    run = p.add_run(text)
    set_run_font(run, '宋体', size, False, color)
    return p


def bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(2)
        if isinstance(item, tuple):
            lead, rest = item
            r = p.add_run(lead)
            set_run_font(r, '宋体', 10.5, True, INK)
            r2 = p.add_run(rest)
            set_run_font(r2, '宋体', 10.5, False, BODY)
        else:
            r = p.add_run(item)
            set_run_font(r, '宋体', 10.5, False, BODY)


def caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(12)
    r = p.add_run(text)
    set_run_font(r, '微软雅黑', 9, False, GREY)
    return p


def figure(doc, filename, text):
    FIG['n'] += 1
    path = os.path.join(SHOT, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(path, width=Cm(15.4))
    caption(doc, f'图 {FIG["ch"]}-{FIG["n"]}　{text}')


def table(doc, headers, rows, widths=None, font_size=9.5, header_fill=HEADER_FILL):
    tbl = doc.add_table(rows=1, cols=len(headers))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    table_borders(tbl)
    cell_margins(tbl)
    hdr = tbl.rows[0].cells
    for i, text in enumerate(headers):
        shade(hdr[i], header_fill)
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        r = p.add_run(text)
        set_run_font(r, '微软雅黑', font_size, True, WHITE)
        if widths:
            hdr[i].width = Cm(widths[i])
    for idx, row in enumerate(rows):
        cells = tbl.add_row().cells
        for i, text in enumerate(row):
            if idx % 2 == 1:
                shade(cells[i], ZEBRA)
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            r = p.add_run(str(text))
            set_run_font(r, '宋体', font_size, False, BODY)
            if widths:
                cells[i].width = Cm(widths[i])
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl


def flow(doc, text):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_borders(tbl, 'BBD3F5', 4)
    cell = tbl.rows[0].cells[0]
    shade(cell, BAND_FILL)
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(text)
    set_run_font(r, '微软雅黑', 10, True, INK)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def callout(doc, title, text):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_borders(tbl, 'BBD3F5', 4)
    cell = tbl.rows[0].cells[0]
    shade(cell, CALLOUT_FILL)
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.35
    r = p.add_run(title)
    set_run_font(r, '微软雅黑', 9.5, True, ACCENT)
    r2 = p.add_run('　' + text)
    set_run_font(r2, '宋体', 9.5, False, BODY)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


# --------------------------------------------------------------------------- 封面
def cover(doc):
    for _ in range(3):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run('DATA SECURITY GOVERNANCE & SERVICE PLATFORM')
    set_run_font(r, '微软雅黑', 9.5, True, ACCENT)
    r._element.get_or_add_rPr().append(_letter_spacing(60))

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(16)
    r = p.add_run('一体化数据安全治理工作台')
    set_run_font(r, '微软雅黑', 12, False, GREY)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.1
    r = p.add_run('大数据安全治理')
    set_run_font(r, '微软雅黑', 34, True, INK)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(18)
    p.paragraph_format.line_spacing = 1.1
    r = p.add_run('与服务保障平台')
    set_run_font(r, '微软雅黑', 34, True, INK)

    rule = doc.add_paragraph()
    rule.paragraph_format.space_after = Pt(10)
    para_border(rule, '1F6FEB', 18, 'bottom', 1)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(30)
    r = p.add_run('用户操作手册　·　普通用户版')
    set_run_font(r, '微软雅黑', 17, False, ACCENT)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(26)
    p.paragraph_format.line_spacing = 1.5
    r = p.add_run('资产看得清　合规查得到　风险管得住\n权限控得严　审计追得回　运维兜得底')
    set_run_font(r, '微软雅黑', 11.5, False, BODY)

    info = doc.add_table(rows=4, cols=2)
    info.autofit = False
    table_borders(info, 'DCE5F2', 4)
    cell_margins(info, 90, 90, 120, 120)
    rows = [
        ('文档版本', 'V1.0.0'),
        ('适用对象', '平台业务用户（数据管理、安全合规、审计、运维、部门主管等）'),
        ('演示环境', 'http://127.0.0.1:5174　（接口 http://127.0.0.1:8081/api）'),
        ('编制日期', '2026 年 11 月'),
    ]
    for i, (k, v) in enumerate(rows):
        c0, c1 = info.rows[i].cells
        c0.width = Cm(3.6)
        c1.width = Cm(13.0)
        shade(c0, ZEBRA)
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(k)
        set_run_font(r0, '微软雅黑', 9.5, True, INK)
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(v)
        set_run_font(r1, '宋体', 9.5, False, BODY)

    doc.add_page_break()


def _letter_spacing(twips):
    el = OxmlElement('w:spacing')
    el.set(qn('w:val'), str(twips))
    return el


# --------------------------------------------------------------------------- 目录与阅读指引
def toc(doc):
    h1(doc, '目录', page_break=False)
    body(doc, '本手册按“先看懂全局，再按角色查功能”的顺序编排。第一次使用的读者建议从第 1、2 章读起，'
              '再读第 9、10 章了解各角色分工和一条完整的业务故事；需要查具体功能时，直接翻到第 3–8 章对应模块。', indent=False)
    rows = [
        ('第 1 章　平台概览', '平台是什么、解决什么问题、一条数据的业务闭环、界面地图'),
        ('第 2 章　快速上手', '登录、主界面分区、通用操作约定与权限提示'),
        ('第 3 章　数据资产治理', '资产台账、分类分级、生命周期与统计导出'),
        ('第 4 章　安全合规管理', '规则库、自动检查、整改闭环、脱敏、共享审批、合规报告'),
        ('第 5 章　智能风险监测', '监测规则、实时预警、事件处置与溯源'),
        ('第 6 章　权限安全管控', '用户、角色、菜单与接口权限、数据范围、安全策略'),
        ('第 7 章　安全审计追溯', '四类日志、完整性校验与审计报表'),
        ('第 8 章　服务保障运维', '资源监控、告警、工单闭环、备份、配置与版本'),
        ('第 9 章　角色使用指引', '八类角色的职责、常用页面与权限边界'),
        ('第 10 章　一条数据的业务旅程', '从资产登记到审计复盘，六模块在同一条时间线上的协作'),
        ('第 11 章　常见问题', '登录、权限、数据范围、看板刷新等常见疑问'),
        ('第 12 章　演示环境说明', '演示数据、演示级近似能力与使用边界'),
        ('附录', '演示账号、页面地图、术语表'),
    ]
    table(doc, ['章节', '主要内容'], rows, widths=[5.6, 10.8], font_size=9.5)
    callout(doc, '延伸阅读',
            '本手册只讲“怎么用”。安装部署、接口开发、验收与决策记录见项目 docs 目录下同名文档，'
            '业务演示的推荐路线见《演示脚本》。')

    h2(doc, '阅读约定')
    bullets(doc, [
        ('按钮路径：', '用「模块 › 页面 › 按钮」表示，例如「智能风险监测 › 风险事件 › 处置」。'),
        ('角色说明：', '不同角色看到的菜单与按钮不同；手册中“管理员”指拥有对应模块写权限的角色。'),
        ('示例数字：', '截图与示例均为演示数据，你的环境重建数据后可能略有差异，但口径一致。'),
        ('提示框：', '蓝色底纹的“小贴士”是操作经验与实际使用中容易踩坑的地方。'),
    ])


# --------------------------------------------------------------------------- 第 1 章
def chapter_overview(doc):
    FIG['ch'], FIG['n'] = 1, 0
    h1(doc, '第 1 章　平台概览')

    h2(doc, '1.1　平台是什么')
    body(doc, '大数据安全治理与服务保障平台是一套面向数据安全管理岗位的一体化工作平台。它把分散在不同部门、'
              '不同系统里的数据资产台账、合规检查、风险事件、权限授权、审计日志和运维工单收拢到同一个工作台，'
              '让“数据有哪些、敏感到什么程度、有没有违规、谁在访问、出了问题怎么处理”这几个问题在一处找到答案。')
    body(doc, '平台按“事前预防、事中监控、事后追溯”的思路组织功能：事前通过分类分级、合规规则和权限授权把风险挡在门外；'
              '事中通过实时监测和四级预警及时发现问题并推动处置；事后通过审计日志、完整性校验和报表完成追溯与复盘。'
              '在此基础上，服务保障运维把平台自身的稳定运行也纳入同一个闭环。')

    h2(doc, '1.2　平台解决的问题')
    table(doc, ['工作阶段', '业务人员关心的问题', '平台提供的能力', '对应模块'], [
        ('事前预防', '哪些数据敏感？有哪些法规要求必须遵守？谁可以看？', '资产分类分级、合规规则库与自动检查、角色与数据范围授权、脱敏与共享审批', '数据资产治理\n安全合规管理\n权限安全管控'),
        ('事中监控', '现在有没有异常访问？谁在批量导出？有没有敏感数据外传？', '实时监测、五类异常识别、四级预警、事件处置闭环、溯源链路', '智能风险监测'),
        ('事后追溯', '这件事是谁做的？日志有没有被改动过？', '登录/访问/操作/接口四类日志、SHA-256 完整性校验、日周月年报表', '安全审计追溯'),
        ('运行保障', '系统稳不稳？告警谁处理？数据有没有备份？', '资源监控与阈值告警、工单四态闭环、备份记录、配置与版本管理', '服务保障运维'),
    ], widths=[2.2, 4.6, 6.4, 3.2])

    h2(doc, '1.3　一条数据的业务闭环')
    body(doc, '一条数据从进入平台到最终销毁，会依次经过下面这些环节。每个环节都有明确的负责人、操作页面和留痕记录，'
              '环环相扣，形成“治理—合规—监测—处置—审计—保障”的闭环。')
    flow(doc, '采集登记  →  分类分级  →  合规检查  →  风险监测  →  处置整改  →  审计留痕  →  运维保障')
    body(doc, '举例来说：数据管理员把客户信息登记为“机密”级资产；合规专员按《个人信息保护法》要求执行检查，'
              '发现未脱敏展示的问题并开整改单；风险监测发现有人短时间内批量导出该资产，生成“紧急”事件并通知安全管理员；'
              '安全管理员处置后，审计员可在日志中查到完整操作链；运维工程师则通过工单跟踪本次处置过程中的服务请求。')

    h2(doc, '1.4　界面地图')
    body(doc, '登录后，左侧导航固定为七个模块。下表是完整的菜单与页面地图，后续章节按这个顺序介绍。')
    table(doc, ['模块', '子页面', '页面路径', '主要用途'], [
        ('平台总览', '安全运营总览', '/dashboard', '一屏查看资产、合规、风险、工单的关键指标与趋势'),
        ('数据资产治理', '资产台账、分类分级、生命周期', '/asset/list、/asset/categories、/asset/lifecycle', '资产登记、分级分类、标签与生命周期管理'),
        ('安全合规管理', '规则库、合规检查、整改跟踪、脱敏管理、共享审批、合规报告', '/compliance/rules 等 6 页', '按法规要求自动检查并推动整改闭环'),
        ('智能风险监测', '风险事件、监测规则、实时监控', '/risk/events、/risk/rules、/risk/realtime', '异常行为识别、四级预警与事件处置'),
        ('权限安全管控', '用户管理、角色管理、菜单权限、接口权限', '/rbac/users 等 4 页', '用户、角色、菜单与接口四级授权'),
        ('安全审计追溯', '审计日志、审计报表', '/audit/logs、/audit/reports', '四类日志查询、完整性校验与报表生成'),
        ('服务保障运维', '运行监控、运维工单、备份管理、平台配置、版本管理', '/ops/monitor 等 5 页', '监控告警、工单闭环、备份与配置版本管理'),
    ], widths=[2.6, 5.4, 4.6, 3.8])


# --------------------------------------------------------------------------- 第 2 章
def chapter_start(doc):
    FIG['ch'], FIG['n'] = 2, 0
    h1(doc, '第 2 章　快速上手')

    h2(doc, '2.1　登录平台')
    body(doc, '在浏览器地址栏输入平台地址（演示环境为 http://127.0.0.1:5174），进入登录页。输入管理员分配的账号和密码，'
              '点击「登录」即可进入平台。首次登录后建议在右上角账号菜单中修改初始密码。')
    figure(doc, '01-login.png', '登录页面：左侧为平台介绍，右侧输入账号密码，下方提供演示账号快捷入口')
    body(doc, '平台对登录安全有几条固定规则：连续输错密码 5 次，账号会被锁定 30 分钟；密码长度不少于 10 位，'
              '且必须同时包含大写字母、小写字母、数字和特殊字符；登录成功后会话有效期为 12 小时，到期需重新登录。')
    callout(doc, '小贴士',
            '演示环境提供多个角色账号（见附录 A）。想体验“只读”效果，可用审计员账号 auditor 登录；'
            '想体验“本部门数据”效果，可用部门主管 depthead 登录。')

    h2(doc, '2.2　认识主界面')
    body(doc, '登录后的第一个页面是「平台总览」。整个界面可以分成六个区域，熟悉它们之后，所有业务页面的操作方式都是一致的。')
    figure(doc, '02-dashboard.png', '平台总览：顶部为全局操作区，中间为指标卡与图表，下方为重点事件与运维态势')
    table(doc, ['界面区域', '位置', '作用'], [
        ('左侧导航', '页面最左侧', '七个业务模块入口，点击模块展开子页面；顶部按钮可折叠导航，扩大内容区'),
        ('顶部栏', '页面顶部', '面包屑定位当前位置；通知铃铛查看待办消息；右侧显示时间与当前账号菜单'),
        ('标题与操作区', '内容区上方', '页面标题、一句话说明，以及“新增、导出、执行检查”等主要操作按钮'),
        ('筛选卡片', '标题下方', '按关键词、状态、时间等条件查询数据，点「查询」生效、点「重置」清空条件'),
        ('指标与图表', '页面中部', '统计卡片、环形图、折线图、条形图，用于快速判断整体情况'),
        ('数据表格', '页面下部', '分页展示业务数据；点「详情」在右侧抽屉中查看完整信息与关联记录'),
    ], widths=[3.0, 3.4, 10.0])

    h2(doc, '2.3　通用操作约定')
    bullets(doc, [
        ('查询与重置：', '筛选条件填写后点「查询」刷新列表；点「重置」恢复默认条件。列表默认每页 10 条，可切换每页条数。'),
        ('详情抽屉：', '列表中的「详情」会在右侧滑出抽屉，展示字段明细、关联记录和操作按钮，不离开当前页面。'),
        ('导出：', '资产台账、审计日志等页面支持导出 CSV，导出内容与当前筛选条件一致，可直接用 Excel 打开。'),
        ('按钮灰显：', '看不到或点不动的按钮通常意味着当前角色没有该操作权限，这是平台的正常保护机制。'),
        ('操作反馈：', '新增、修改、审批等操作完成后，右上角会出现成功提示；失败时会说明原因，例如“无权操作”“数据不存在”。'),
    ])
    callout(doc, '小贴士',
            '很多页面支持“点击行查看详情”，但删除、审批、处置这类敏感操作一定需要二次确认。'
            '如果误操作，可联系管理员处理；演示环境也可以由管理员重建数据恢复初始状态。')


# --------------------------------------------------------------------------- 第 3 章
def chapter_asset(doc):
    FIG['ch'], FIG['n'] = 3, 0
    h1(doc, '第 3 章　数据资产治理')
    body(doc, '数据资产治理解决“有哪些数据、敏感到什么程度、由谁负责”的问题，是后续合规、风险和权限工作的基础。'
              '平台把每一份数据登记为一条“资产”，记录它的来源系统、所属分类、数据级别、责任部门与责任人，'
              '并持续跟踪它在采集、存储、使用、共享、销毁各阶段的变化。')
    flow(doc, '采集登记  →  分类分级  →  打标签与定责任人  →  生命周期跟踪  →  扫描复核  →  统计导出')

    h2(doc, '3.1　资产台账')
    body(doc, '「资产台账」是全平台资产的总清单。上方五张卡片分别汇总资产总量、敏感资产、平均质量分、平均敏感度和存储规模；'
              '下方表格列出每条资产的核心信息，支持按关键词、数据级别、资产状态、所属分类、责任部门、生命周期阶段筛选。')
    figure(doc, '03-asset-list.png', '资产台账：统计卡片、七类筛选条件与资产列表，敏感度以彩色进度条直观呈现')
    body(doc, '常用操作包括：')
    bullets(doc, [
        ('登记资产：', '点右上角「登记资产」，填写名称、来源系统、分类、级别、责任人等信息后保存，系统自动生成资产编号。'),
        ('调整分级：', '在列表中点「分级调整」，可把资产从“内部”调为“机密”等；调级会写入生命周期记录，便于追溯。'),
        ('扫描复核：', '点「扫描复核」对单条资产重新识别，或点「全局扫描」批量复核，识别结果会更新分类与敏感度建议。'),
        ('导出与查看：', '点「导出台账」下载 CSV；点资产名称或「详情」查看标签、生命周期轨迹与完整字段。'),
    ])

    h2(doc, '3.2　分类分级')
    body(doc, '平台按公开、内部、机密、绝密四个级别管理数据，并维护八类资产分类（如客户信息、交易数据、身份认证、医疗健康等）。'
              '「分类分级」页面左侧是分类树，右侧用环形图和柱状图展示各级别、各分类的资产分布。点击分类树中的节点，'
              '右侧统计与资产列表会联动刷新。')
    figure(doc, '04-asset-categories.png', '分类分级：左侧分类树联动右侧分级分布与分类统计')
    callout(doc, '小贴士',
            '级别判定建议遵循“就高不就低”：只要能识别到个人身份、健康、金融账户等信息，至少应定为“机密”。'
            '分级不是一次性的，数据用途变化或新增关联字段时应重新评估。')

    h2(doc, '3.3　生命周期')
    body(doc, '每条资产都有一条从“采集”到“销毁”的生命周期轨迹。页面以五个阶段展示各阶段资产数量，'
              '并在下方列出最近的生命周期事件，包括时间、阶段、动作、操作人和说明。')
    figure(doc, '05-asset-lifecycle.png', '生命周期：五阶段分布与最近生命周期事件时间线')
    table(doc, ['阶段', '典型动作', '平台记录'], [
        ('采集', '从业务系统接入、批量导入', '来源系统、采集时间、采集方式'),
        ('存储', '落库、归档、加密存储', '存储位置、格式、容量'),
        ('使用', '查询、分析、建模', '使用部门、使用人、使用目的'),
        ('共享', '跨部门共享、对外提供', '共享对象、共享方式、审批记录'),
        ('销毁', '到期删除、介质销毁', '销毁时间、执行人、销毁方式'),
    ], widths=[2.2, 7.0, 7.2])


# --------------------------------------------------------------------------- 第 4 章
def chapter_compliance(doc):
    FIG['ch'], FIG['n'] = 4, 0
    h1(doc, '第 4 章　安全合规管理')
    body(doc, '安全合规管理把《数据安全法》《个人信息保护法》和等级保护 2.0 的要求，翻译成一条条可执行、可检查的规则。'
              '平台内置合规规则库，按批次自动检查资产与流程是否达标，把不通过项转为整改任务，'
              '并在数据共享、脱敏展示等环节提供审批与脱敏手段，最终形成可对外汇报的合规报告。')
    flow(doc, '规则库  →  自动检查  →  结果分级  →  整改闭环  →  脱敏与共享审批  →  合规报告')

    h2(doc, '4.1　合规规则库')
    body(doc, '规则库按“分类分级、访问控制、加密脱敏、审计留痕、跨境传输、合规管理”六类组织，每条规则记录法规依据、'
              '具体要求、风险等级和检查方式（自动或人工）。安全合规人员可新增、修改规则，也可以停用不再适用的条款。')
    figure(doc, '06-compliance-rules.png', '合规规则库：按法规分类的规则清单，支持检索、新增与编辑')
    body(doc, '新增规则时建议写清三件事：依据哪条法规、检查什么对象、不通过时如何判定。规则写得越具体，自动检查的结果越可用。')

    h2(doc, '4.2　执行合规检查')
    body(doc, '「合规检查」页面用于发起一次检查并查看结果。点击「执行检查」后，平台按当前启用的规则逐条检查资产与配置，'
              '生成新的检查批次（批次号形如 CHK-2026-006），每条结果分为通过、警告、不通过三种，并给出得分与证据。')
    figure(doc, '07-compliance-checks.png', '合规检查：统计卡片、批次通过率趋势与检查结果明细')
    body(doc, '页面上方的趋势图展示最近几个批次的通过率变化，便于判断合规水平是在改善还是恶化。点击结果行可查看证据详情，'
              '包括检查对象、规则要求、实际值和检查耗时。')

    h2(doc, '4.3　整改跟踪')
    body(doc, '检查中不通过或警告的条目会自动进入整改池，生成整改单并指派责任人与截止日期。整改单有“待整改、整改中、已闭环、已逾期”四种状态，'
              '责任人填写整改进度与措施，合规人员确认后闭环；超过截止日期未完成的会标记为已逾期。')
    figure(doc, '08-compliance-rectify.png', '整改跟踪：按状态统计与整改进度管理')
    callout(doc, '小贴士',
            '整改闭环的关键是“可验证”：措施里写清楚改了什么（例如“客户手机号改为掩码展示”），'
            '并把证据（截图、配置项）留档，复查时才能快速确认。')

    h2(doc, '4.4　脱敏管理')
    body(doc, '平台支持静态与动态两类脱敏：静态脱敏用于数据导出、测试数据准备；动态脱敏用于查询展示时按角色实时掩码。'
              '每条脱敏规则定义字段匹配模式、算法（掩码、哈希、加密、泛化）与适用场景，可在页面上“试运行”查看脱敏前后效果。')
    figure(doc, '09-compliance-masking.png', '脱敏管理：规则列表与脱敏前后样例对比')
    body(doc, '使用建议：展示类场景优先用掩码（保留部分字符便于核对），统计分析场景用哈希或泛化，'
              '需要还原的场景才使用加密，并严格限制密钥访问。')

    h2(doc, '4.5　共享审批')
    body(doc, '跨部门或对外提供数据前，需要在「共享审批」中提交申请，填写资产、接收方、共享用途、共享方式与风险等级。'
              '审批人查看申请后通过或驳回，全过程留痕。待审批的申请会出现在首页待办和顶部通知中。')
    figure(doc, '10-compliance-approvals.png', '共享审批：申请列表、审批状态与审批操作')
    body(doc, '审批关注三点：用途是否必要、接收方是否可信、共享方式是否安全（优先脱敏后共享、优先接口而非文件）。')

    h2(doc, '4.6　合规报告')
    body(doc, '「合规报告」汇总最近批次的通过率、不通过的规则清单与整改情况，可一键导出，作为向管理层或监管方汇报的材料。')
    figure(doc, '11-compliance-report.png', '合规报告：批次通过率、问题清单与导出入口')


# --------------------------------------------------------------------------- 第 5 章
def chapter_risk(doc):
    FIG['ch'], FIG['n'] = 5, 0
    h1(doc, '第 5 章　智能风险监测')
    body(doc, '风险监测负责“事中发现问题”。平台持续观察账号行为与数据访问，围绕越权访问、批量导出、异常登录、数据篡改、'
              '敏感外传五类高风险行为建立监测规则，命中后生成风险事件，按低、中、高、紧急四级预警，并推动处置闭环。')
    flow(doc, '规则配置  →  实时监测  →  事件生成  →  分级预警  →  处置或忽略  →  溯源复盘')

    h2(doc, '5.1　风险事件')
    body(doc, '「风险事件」是处置工作的主页面。列表展示事件编号、事件类型、关联资产、级别、状态、操作账号与 IP、归属部门、发生时间，'
              '支持按级别、状态、类型、关键词和时间范围筛选。点击「详情」可看到事件详情、关联事件与溯源链路。')
    figure(doc, '12-risk-events.png', '风险事件：多条件筛选与事件列表，级别与状态用颜色区分')
    body(doc, '处置一条事件的典型步骤：')
    bullets(doc, [
        ('核实：', '打开详情，确认操作账号、IP、设备、时间与关联资产是否与业务预期一致。'),
        ('处置：', '点「处置」，填写处置说明（如“已联系账号本人确认，为正常对账导出，已补充审批”），事件状态变为已处置。'),
        ('忽略：', '确认是误报时点「忽略」，需填写原因，便于后续优化规则。'),
        ('溯源：', '在详情中查看溯源链路，了解同一账号或同一资产的关联行为。'),
    ])
    callout(doc, '小贴士',
            '处置不是“点一下按钮”，而是留下可复盘的事实。处置说明建议包含“谁、在什么时间、为什么、做了什么”，'
            '这样审计复查时不需要再找人问。')

    h2(doc, '5.2　监测规则')
    body(doc, '监测规则页面列出当前启用的规则，展示每条规则的命中次数对比，并可单独启停。规则停用后不再产生新事件，'
              '但历史事件保留，便于对比效果。')
    figure(doc, '13-risk-rules.png', '监测规则：规则清单、命中数对比与启停开关')
    body(doc, '调整规则前建议先观察一段时间的命中情况：命中过高说明阈值过松，会产生大量误报；命中过低则可能漏报。')

    h2(doc, '5.3　实时监控')
    body(doc, '实时监控页面按分钟展示风险态势：四个级别的计数卡片、24 小时事件折线、事件类型分布、最新事件滚动列表、'
              '重点 IP 排行和每分钟事件柱状图。页面每 30 秒自动刷新，适合投屏作为安全运营大屏使用。')
    figure(doc, '14-risk-realtime.png', '实时监控：四级计数卡片、趋势图、类型分布与重点 IP 排行')


# --------------------------------------------------------------------------- 第 6 章
def chapter_rbac(doc):
    FIG['ch'], FIG['n'] = 6, 0
    h1(doc, '第 6 章　权限安全管控')
    body(doc, '权限管控决定“谁能看什么、能改什么”。平台采用用户、角色、菜单、接口四级授权模型，再叠加数据范围'
              '（全部数据、本部门数据、仅本人数据）形成纵深防御。用户的最终权限来自其角色，调整角色即调整一批人的权限。')
    flow(doc, '新建用户  →  分配角色  →  授权菜单与页面  →  授权接口  →  设定数据范围  →  执行安全策略')

    h2(doc, '6.1　用户管理')
    body(doc, '「用户管理」维护平台账号：姓名、账号、部门、岗位、联系方式、角色与状态。支持按部门与关键词筛选，'
              '可新增用户、编辑资料、停用账号、重置密码。停用后该账号无法登录，但历史操作记录保留。')
    figure(doc, '15-rbac-users.png', '用户管理：按部门筛选、用户列表与新增/编辑入口')
    body(doc, '新员工入职的标准动作是：新增用户 → 分配角色 → 通知本人首次登录后修改密码；'
              '员工离职或转岗时，第一时间停用账号或调整角色，避免权限残留。')

    h2(doc, '6.2　角色管理')
    body(doc, '平台预置八类角色：超级管理员、安全管理员、合规专员、数据管理员、审计员、运维工程师、部门主管、数据分析师。'
              '每个角色卡片上可以看到该角色的用户数、授权菜单数与接口数，并列出各模块的读/写权限。点「配置权限」可进入菜单与接口授权。')
    figure(doc, '16-rbac-roles.png', '角色管理：角色卡片、模块读写权限与配置权限入口')
    table(doc, ['角色', '典型职责', '数据范围'], [
        ('超级管理员', '平台全局配置、账号与权限管理', '全部数据'),
        ('安全管理员', '安全策略、风险处置与合规监督', '全部数据'),
        ('合规专员', '合规检查、整改跟踪与共享审批', '本部门数据'),
        ('数据管理员', '资产台账、分类分级与生命周期维护', '本部门数据'),
        ('审计员', '日志审查与报表审阅，只读', '全部数据'),
        ('运维工程师', '监控、备份、工单与配置维护', '本部门数据'),
        ('部门主管', '本部门资产与风险的查看与审批', '本部门数据'),
        ('数据分析师', '只读查看资产与看板', '仅本人数据'),
    ], widths=[3.2, 8.0, 3.4])

    h2(doc, '6.3　菜单权限与接口权限')
    body(doc, '菜单权限决定“登录后能看到哪些页面和按钮”，接口权限决定“能不能调用背后的数据接口”。两者配合，'
              '既保证界面上不出现越权入口，也保证即使手工构造请求同样会被拒绝。')
    figure(doc, '17-rbac-menus.png', '菜单权限：菜单树与各角色的可见性矩阵')
    figure(doc, '18-rbac-apis.png', '接口权限：按模块分组的接口清单、角色授权矩阵与安全策略')
    callout(doc, '小贴士',
            '调整权限后，已登录用户需要重新登录才能看到新的菜单。这是有意设计：权限在登录时装载，'
            '重新认证能让变更立即生效，也避免会话中途权限漂移。')


# --------------------------------------------------------------------------- 第 7 章
def chapter_audit(doc):
    FIG['ch'], FIG['n'] = 7, 0
    h1(doc, '第 7 章　安全审计追溯')
    body(doc, '审计追溯回答“出了事怎么查、查了算不算数”。平台自动记录登录、访问、操作、接口四类日志，'
              '日志不可在界面上修改或删除；每条日志都有哈希值并与前一条日志形成链式校验，'
              '配合日、周、月、年报表，支撑事后追溯与定期复盘。')
    flow(doc, '自动留痕  →  多条件查询  →  查看详情  →  完整性校验  →  生成报表  →  导出归档')

    h2(doc, '7.1　审计日志')
    body(doc, '「审计日志」支持按日志类型、操作人、关键词和时间范围查询。列表展示时间、类型、操作人、动作、资源、'
              'IP 与结果；点「详情」可查看完整字段，包括请求方法、路径、浏览器标识和哈希校验结果。')
    figure(doc, '19-audit-logs.png', '审计日志：类型筛选、日志列表与详情入口')
    body(doc, '日志详情的价值在于“还原现场”：谁在什么时间、从哪个 IP、用什么设备、对哪条数据做了什么，结果如何。'
              '排查安全事件时，建议先用账号或 IP 定位，再按时间线串联前后操作。')

    h2(doc, '7.2　完整性校验')
    body(doc, '点击页面上的「完整性校验」，平台会重新计算日志哈希链并与记录值比对，返回“链完整”或指出异常位置。'
              '这项能力用于说明“日志没有被悄悄改动”，是审计可信度的基础。')
    callout(doc, '小贴士',
            '完整性校验为演示级实现：基于数据库中的日志实时重建 SHA-256 链。生产环境中通常需要配合只追加存储（WORM）'
            '或第三方存证，才能提供法律意义上的不可篡改证明。')

    h2(doc, '7.3　审计报表')
    body(doc, '「审计报表」按日报、周报、月报、年报四种周期生成报表，包含日志总量、风险事件数、合规率等指标与文字摘要，'
              '支持直接生成并下载，用于定期汇报与归档。')
    figure(doc, '20-audit-reports.png', '审计报表：报表列表与生成入口，报表含统计摘要与周期信息')


# --------------------------------------------------------------------------- 第 8 章
def chapter_ops(doc):
    FIG['ch'], FIG['n'] = 8, 0
    h1(doc, '第 8 章　服务保障运维')
    body(doc, '服务保障运维把平台自身的稳定运行纳入管理：持续采集 CPU、内存、磁盘、接口 QPS、响应时间、数据库连接数和在线用户等指标，'
              '超过阈值自动告警；告警和用户报障通过工单闭环处理；数据定期备份；配置与版本变更全程可追溯。')
    flow(doc, '指标采集  →  阈值告警  →  工单受理  →  处理验证  →  关闭归档  →  备份与配置版本管理')

    h2(doc, '8.1　运行监控')
    body(doc, '「运行监控」展示最近 24 小时的资源与接口态势：CPU、内存、磁盘使用率，接口 QPS 与平均响应时间，'
              '数据库连接数、Redis 命中率和在线用户数。连续高负载或超过阈值时，按告警级别提示。')
    figure(doc, '21-ops-monitor.png', '运行监控：资源指标卡、24 小时趋势与告警列表')
    body(doc, '看到告警时，先判断影响范围：是单一接口变慢，还是整体资源紧张；是短时波动，还是持续上升。'
              '确认后可在告警条目上标记处理，并视情况创建工单跟踪。')

    h2(doc, '8.2　运维工单')
    body(doc, '工单分故障处理、安全事件、服务咨询、变更申请四类，状态按“待受理 → 处理中 → 待验证 → 已关闭”单向流转。'
              '每次状态变化都会记录操作人、时间与说明，形成完整的处理轨迹。')
    figure(doc, '22-ops-tickets.png', '运维工单：按状态筛选的工单列表与新建入口')
    body(doc, '新建工单时填清“现象、影响范围、期望完成时间”，处理人接手后先受理再更新进度，验证通过后再关闭，'
              '避免“跳过验证直接关闭”导致问题复发。')

    h2(doc, '8.3　备份管理')
    body(doc, '备份记录页展示每次备份的类型（全量/增量）、范围、大小、状态、校验码与存放位置。可手动触发一次备份，'
              '系统记录开始与完成时间；失败记录会标记原因，便于排查。')
    figure(doc, '23-ops-backups.png', '备份管理：备份记录、成功率统计与手动备份入口')
    callout(doc, '小贴士',
            '备份的价值在于“能恢复”。建议定期做恢复演练，确认备份文件可用、校验码一致，'
            '而不是只看备份任务是否成功。演示版的备份为逻辑导出记录，不包含真实数据文件。')

    h2(doc, '8.4　平台配置')
    body(doc, '「平台配置」集中管理平台运行参数，按安全、合规、运维、通知等分组展示，例如密码最小长度、登录失败锁定次数、'
              '看板刷新间隔、整改到期提醒天数。修改后立即写入审计日志，可随时回看谁在何时改了什么。')
    figure(doc, '24-ops-configs.png', '平台配置：按分组展示的参数清单与编辑入口')

    h2(doc, '8.5　版本管理')
    body(doc, '「版本管理」记录平台当前版本与历史版本时间线，包括版本号、发布时间、变更说明与状态。'
              '版本记录让“现在跑的是哪个版本、上次改了什么”一目了然，便于问题定位与升级回溯。')
    figure(doc, '25-ops-versions.png', '版本管理：当前版本信息与历史版本时间线')


# --------------------------------------------------------------------------- 第 9 章
def chapter_roles(doc):
    FIG['ch'], FIG['n'] = 9, 0
    h1(doc, '第 9 章　角色使用指引')
    body(doc, '平台按角色分配权限，不同角色登录后看到的菜单、按钮与数据范围不同。下表把“这个角色上班后主要做什么”'
              '和“他能看到什么”整理在一起，便于新同事快速找到自己的位置。')
    table(doc, ['角色 / 账号', '主要工作', '常用页面', '权限边界'], [
        ('超级管理员\nadmin', '平台全局管理：账号、角色、权限、配置、版本', '全部页面', '可写全部模块；权限为保护项，不允许被清空'),
        ('安全管理员\nsecadmin', '安全策略、风险处置、合规监督', '看板、风险、合规、审计、运维、权限（只读）', '可写风险与运维；权限、审计只读'),
        ('合规专员\ncompliance', '规则维护、合规检查、整改跟踪、共享审批、脱敏', '合规全部 6 页、看板、资产（只读）', '仅本部门数据；权限、审计只读'),
        ('数据管理员\nsteward', '资产登记、分类分级、生命周期、扫描复核', '资产全部 3 页、看板', '可写资产；仅本部门数据；其他模块只读或不可见'),
        ('审计员\nauditor', '日志审查、完整性校验、报表审阅', '审计 2 页、看板', '全部数据只读，无任何写权限'),
        ('运维工程师\nops', '监控告警、工单处理、备份、配置与版本', '运维全部 5 页、看板', '可写运维；仅本部门数据；其他模块只读'),
        ('部门主管\ndepthead', '本部门资产与风险的查看与审批', '看板、资产、风险、合规、运维', '仅本部门数据；写权限有限'),
        ('数据分析师\nanalyst', '只读查看看板与资产分布', '看板、资产、合规、风险、运维（只读）', '仅本人数据；无权限、审计入口'),
    ], widths=[3.2, 4.8, 4.2, 4.2])
    callout(doc, '小贴士',
            '要验证某个角色的权限边界，最直接的办法是用该角色登录：看不到的菜单即无读权限，灰掉的按钮即无写权限。'
            '如果发现与预期不符，请管理员在「角色管理」中核对菜单与接口授权。')


# --------------------------------------------------------------------------- 第 10 章
def chapter_story(doc):
    FIG['ch'], FIG['n'] = 10, 0
    h1(doc, '第 10 章　一条数据的业务旅程')
    body(doc, '下面用一周内发生的一件事，把六个模块串起来看。故事中的角色、数据与页面都来自平台演示环境，'
              '你可以按同样的路径自己走一遍。')
    table(doc, ['时间', '角色', '做了什么', '平台反馈与留痕'], [
        ('周一 09:10', '数据管理员 steward', '把“客户身份信息”登记为资产，定为“机密”，责任人指向本部门', '生成资产编号；生命周期记一条“采集”记录'),
        ('周一 10:30', '合规专员 compliance', '执行合规检查，发现该资产未脱敏展示', '生成批次 CHK-2026-006；产生整改单，指派责任人'),
        ('周一 15:00', '数据管理员 steward', '在脱敏管理中新增掩码规则并试运行，整改完成', '整改单闭环；脱敏前后样例留档'),
        ('周二 11:20', '（系统自动）', '监测到账号短时间批量导出该资产', '生成“紧急”级风险事件并通知安全管理员'),
        ('周二 11:35', '安全管理员 secadmin', '核实后完成处置，补充导出审批说明', '事件转“已处置”；写入操作日志与通知'),
        ('周三 10:00', '审计员 auditor', '按账号与时间查询操作日志，执行完整性校验', '查到登记、整改、处置全链路；返回“链完整”'),
        ('周四 14:00', '运维工程师 ops', '为本次导出配合开了变更工单，处理完成后关闭', '工单四态流转并记录轨迹；监控无异常告警'),
        ('周五 17:00', '部门主管 depthead', '查看本部门看板与风险未闭环数，确认风险已收敛', '看板仅显示本部门数据，未闭环数下降'),
    ], widths=[2.4, 3.0, 6.4, 4.6])
    body(doc, '这件事说明：平台上每一条数据、每一次操作都不是孤立记录。资产分级决定了合规检查的对象，'
              '合规检查发现的问题推动整改，风险监测捕捉异常行为，审计日志把全过程固定下来，运维工单保证处理过程有人负责。'
              '这正是“一体化”与“单点工具”的区别。')


# --------------------------------------------------------------------------- 第 11 章
def chapter_faq(doc):
    FIG['ch'], FIG['n'] = 11, 0
    h1(doc, '第 11 章　常见问题')
    table(doc, ['问题', '原因与处理'], [
        ('忘记密码怎么办？', '联系管理员在「权限安全管控 › 用户管理」中重置密码；重置后首次登录请立即修改。'),
        ('提示账号已被锁定？', '连续输错 5 次密码会锁定 30 分钟。可等待自动解锁，或由管理员在用户管理中解除锁定。'),
        ('页面上的按钮是灰色的？', '当前角色没有该操作的写权限。请联系管理员在「角色管理 › 配置权限」中授权后重新登录。'),
        ('为什么只能看到本部门的数据？', '账号的数据范围是“本部门”或“仅本人”，这是权限隔离的正常表现，不是数据缺失。'),
        ('看板数字为什么和刚操作的对不上？', '看板有约 20 秒缓存，稍等或点「刷新数据」即可；页面的统计口径以缓存时间为准。'),
        ('导出的 CSV 打开是乱码？', '请用 Excel 或 WPS 直接打开；平台已按 UTF-8 带 BOM 导出，若用记事本打开可能是编码显示问题。'),
        ('演示数据被改乱了怎么办？', '联系管理员执行数据重建（重置为演示基线），约 10 秒完成，期间请勿操作。'),
        ('平台里的扫描、备份、脱敏是真的吗？', '演示版的流程、页面与留痕都是真实的，底层能力为演示级近似：资产扫描按规则模拟识别，备份记录为逻辑导出，脱敏为规则演示，哈希链为实时重建。'),
        ('登录后多久需要重新登录？', '会话有效期 12 小时；修改密码、调整权限或管理员停用账号后，需要重新登录。'),
        ('能否对接我们的真实系统？', '接口与表结构已经抽象，替换扫描器、采集器、备份系统即可对接；集群、多租户、SIEM 等不在本期演示范围。'),
    ], widths=[5.2, 11.2])
    callout(doc, '小贴士',
            '遇到报错提示时，先看提示文字里的状态码：403 是权限不足，401 是未登录或会话过期，400 是填写内容不符合要求，'
            '500 是服务端异常需要联系运维。')


# --------------------------------------------------------------------------- 第 12 章
def chapter_demo(doc):
    FIG['ch'], FIG['n'] = 12, 0
    h1(doc, '第 12 章　演示环境说明')
    body(doc, '本手册配套的平台是软著演示版本，用于完整展示数据安全治理的业务流程与功能设计。为避免误解，'
              '这里把演示环境的边界说明清楚。')
    table(doc, ['事项', '说明'], [
        ('数据来源', '全部为演示数据，不包含任何真实个人信息、真实客户数据或生产系统数据；数据可一键重建。'),
        ('部署形态', '单机单实例演示：MySQL 与 Redis 运行在本地 Docker 容器，前后端以本机进程运行。'),
        ('演示级近似', '资产扫描、监控采集、备份、脱敏试运行、日志哈希链校验为演示级实现，业务流程与数据留痕真实，底层能力为模拟。'),
        ('性能与可用性', '面向演示与功能验收，未做并发压测，不承诺 99.9% 可用率与响应时间指标。'),
        ('不在本期范围', 'Kubernetes 集群、多租户隔离、真实脱敏引擎、SIEM 对接、软著登记材料。'),
        ('数据重建', '管理员执行数据重建后恢复初始基线，演示中产生的审批、工单、日志会被清理。'),
    ], widths=[3.4, 13.0])
    body(doc, '尽管是演示版，平台在工程上仍坚持三条原则：接口契约先行，前后端按同一份契约开发；数据可重放，'
              '每次重建的计数与分布一致、可断言；关键操作全部留痕，演示中做的每一步都能在审计日志里查到。'
              '这让它既能用于汇报演示，也能作为后续真实建设的骨架。')


# --------------------------------------------------------------------------- 附录
def appendix(doc):
    h1(doc, '附录')
    h2(doc, '附录 A　演示账号')
    body(doc, '演示环境预置八类账号，密码规则统一为“角色名 @2026”形式，具体如下。')
    table(doc, ['账号', '密码', '角色', '建议体验内容'], [
        ('admin', 'Admin@2026', '超级管理员', '全部功能与配置管理'),
        ('secadmin', 'Sec@2026', '安全管理员', '风险处置、规则启停、看板'),
        ('compliance', 'Comp@2026', '合规专员', '合规检查、整改、脱敏、共享审批'),
        ('steward', 'Steward@2026', '数据管理员', '资产登记、分级调整、生命周期'),
        ('auditor', 'Audit@2026', '审计员', '日志查询、完整性校验、报表（只读）'),
        ('ops', 'Ops@2026', '运维工程师', '监控告警、工单、备份、配置、版本'),
        ('depthead', 'Dept@2026', '部门主管', '本部门数据范围的看板与审批'),
        ('analyst', 'Analyst@2026', '数据分析师', '只读看板与资产分布'),
    ], widths=[3.0, 3.6, 3.4, 6.4])
    callout(doc, '安全提示',
            '演示账号仅用于本机演示环境，请勿在联网环境使用相同密码；正式环境应删除演示账号并启用强密码策略。')

    h2(doc, '附录 B　页面地图')
    table(doc, ['一级菜单', '二级页面', '说明'], [
        ('平台总览', '安全运营总览', '资产、合规、风险、工单关键指标与趋势'),
        ('数据资产治理', '资产台账 / 分类分级 / 生命周期', '资产登记、分级分类、标签与生命周期'),
        ('安全合规管理', '规则库 / 合规检查 / 整改跟踪 / 脱敏管理 / 共享审批 / 合规报告', '法规规则、检查、整改与报告全流程'),
        ('智能风险监测', '风险事件 / 监测规则 / 实时监控', '事件处置、规则配置与实时态势'),
        ('权限安全管控', '用户管理 / 角色管理 / 菜单权限 / 接口权限', '四级权限模型与数据范围'),
        ('安全审计追溯', '审计日志 / 审计报表', '日志查询、完整性校验与报表'),
        ('服务保障运维', '运行监控 / 运维工单 / 备份管理 / 平台配置 / 版本管理', '监控、工单、备份与配置版本'),
    ], widths=[3.4, 8.6, 4.4])

    h2(doc, '附录 C　术语表')
    table(doc, ['术语', '含义'], [
        ('数据资产', '被纳入治理范围的一份数据集合，例如“客户身份信息”“交易流水”。'),
        ('分类分级', '按业务分类和敏感程度（公开 / 内部 / 机密 / 绝密）对数据打标签。'),
        ('合规规则', '把法规要求转成可检查的判断条件，如“敏感数据展示需脱敏”。'),
        ('整改单', '合规检查不通过后生成的待办任务，含责任人、截止日期与进度。'),
        ('脱敏', '对敏感字段做掩码、哈希、加密或泛化，降低展示与流转风险。'),
        ('RBAC', '基于角色的访问控制：用户→角色→菜单/接口→数据范围。'),
        ('数据范围', '账号能看的数据边界，分全部数据、本部门数据、仅本人数据。'),
        ('风险事件', '监测规则命中后生成的一条待处理记录，含级别与处置状态。'),
        ('溯源', '沿时间线还原与某事件相关的账号、IP、资产与操作。'),
        ('哈希链 / 完整性校验', '每条日志的哈希与前一条关联，重算比对可发现是否被改动。'),
        ('SLA', '服务级别约定，本平台用于表示工单的处理时限。'),
    ], widths=[4.6, 11.8])

    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('— 手册完 —')
    set_run_font(r, '微软雅黑', 10, False, GREY)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('大数据安全治理与服务保障平台　V1.0.0　数据安全平台项目组')
    set_run_font(r, '微软雅黑', 9, False, GREY)


def main():
    doc = build_document()
    cover(doc)
    toc(doc)
    chapter_overview(doc)
    chapter_start(doc)
    chapter_asset(doc)
    chapter_compliance(doc)
    chapter_risk(doc)
    chapter_rbac(doc)
    chapter_audit(doc)
    chapter_ops(doc)
    chapter_roles(doc)
    chapter_story(doc)
    chapter_faq(doc)
    chapter_demo(doc)
    appendix(doc)
    doc.save(OUT)
    print('SAVED', OUT)


if __name__ == '__main__':
    main()
