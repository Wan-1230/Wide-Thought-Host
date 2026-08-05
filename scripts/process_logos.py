# 一次性脚本：从生成的 App 图标原图中程序化重建全部品牌资源。
# - 提取干净的白色 W 符号（去除水印/白边）
# - 合成无水印圆角 App 图标（1024x1024）
# - 生成主 Logo 组合图（符号 + Wide Thought Host 字标，深/浅两版透明底）
# - 生成简化单色符号 wth-mark.png
from PIL import Image, ImageDraw, ImageFont

SRC = r"C:\Users\21085\.qoder-cn\vibe_images\wth-app-icon-fullbleed_1785901083.png"
ICONS = r"d:\gork\wth\crates\desktop\wth-desktop\icons"
ASSETS = r"d:\gork\wth\crates\desktop\wth-desktop\ui\src\assets"

CHARCOAL = (14, 14, 16)      # #0E0E10
INK = (26, 26, 26)           # #1A1A1A 浅色主题用近黑
WHITE = (255, 255, 255)
RADIUS_RATIO = 0.22          # 圆角半径比例


def lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


src = Image.open(SRC).convert("RGBA")
w, h = src.size
px = src.load()

# 1) 定位深色圆角方块区域（排除外部白底）
minx, miny, maxx, maxy = w, h, 0, 0
for y in range(0, h, 2):
    for x in range(0, w, 2):
        if lum(px[x, y]) < 100:
            minx = min(minx, x); maxx = max(maxx, x)
            miny = min(miny, y); maxy = max(maxy, y)
print("dark square bbox:", minx, miny, maxx, maxy)

# 2) 在深色区域内提取白色 W 符号（排除右下角水印区域，亮度映射 alpha 保留渐变）
R = int((maxx - minx) * RADIUS_RATIO)


def inside_rounded(x, y):
    # 圆角矩形内部判定（向内收缩 8px，排除边缘抗锯齿亮环）
    M = 8
    ix0, iy0, ix1, iy1 = minx + M, miny + M, maxx - M, maxy - M
    if not (ix0 <= x <= ix1 and iy0 <= y <= iy1):
        return False
    rr = R - M
    cx = ix0 + rr if x < ix0 + rr else (ix1 - rr if x > ix1 - rr else x)
    cy = iy0 + rr if y < iy0 + rr else (iy1 - rr if y > iy1 - rr else y)
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr


mark_minx, mark_miny, mark_maxx, mark_maxy = w, h, 0, 0
mark_alpha = Image.new("L", (w, h), 0)
ma = mark_alpha.load()
for y in range(miny, maxy + 1):
    for x in range(minx, maxx + 1):
        if not inside_rounded(x, y):
            continue
        if x > w * 0.70 and y > h * 0.86:
            continue  # 水印区域
        l = lum(px[x, y])
        if l > 60:
            a = int(min(255, (l - 60) / 195 * 255))
            if a > 0:
                ma[x, y] = a
                mark_minx = min(mark_minx, x); mark_maxx = max(mark_maxx, x)
                mark_miny = min(mark_miny, y); mark_maxy = max(mark_maxy, y)
print("mark bbox:", mark_minx, mark_miny, mark_maxx, mark_maxy)

mark_white = Image.new("RGB", (w, h), WHITE)
mark_white.putalpha(mark_alpha)
mark = mark_white.crop((mark_minx, mark_miny, mark_maxx + 1, mark_maxy + 1))

# 3) 简化单色符号（白色透明底，供 UI 使用，浅色主题用 CSS invert 反色）
mark.save(f"{ASSETS}\\wth-mark.png")
print("saved wth-mark.png", mark.size)

# 4) 无水印 App 图标：透明底 + 炭色圆角方块 + 居中白色符号
S = 1024
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * RADIUS_RATIO),
                       fill=CHARCOAL + (255,))
mark_size = int(S * 0.55)
m = mark.copy()
m.thumbnail((mark_size, mark_size), Image.LANCZOS)
icon.paste(m, ((S - m.width) // 2, (S - m.height) // 2), m)
icon.save(f"{ICONS}\\app-icon.png")
icon.save(f"{ICONS}\\icon-master.png")
icon.save(f"{ASSETS}\\wth-icon.png")
print("saved app-icon.png / icon-master.png / wth-icon.png")

# 5) 主 Logo 组合图：符号 + 字标（单行 lockup，透明底）
FONT_PATH = r"C:\Windows\Fonts\seguisb.ttf"
TEXT = "Wide Thought Host"


def build_lockup(color, out_path):
    font_size = 150
    font = ImageFont.truetype(FONT_PATH, font_size)
    tmp = Image.new("RGBA", (10, 10))
    td = ImageDraw.Draw(tmp)
    tb = td.textbbox((0, 0), TEXT, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]

    mark_h = 220
    m2 = mark.copy()
    m2.thumbnail((mark_h, mark_h), Image.LANCZOS)
    gap = 56
    pad = 24
    canvas_w = pad + m2.width + gap + tw + pad
    canvas_h = pad + max(m2.height, th) + pad
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    colored_mark = Image.new("RGB", m2.size, color)
    colored_mark.putalpha(m2.getchannel("A"))
    my = (canvas_h - m2.height) // 2
    canvas.paste(colored_mark, (pad, my), colored_mark)

    txt_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    td2 = ImageDraw.Draw(txt_layer)
    ty = (canvas_h - th) // 2 - tb[1]
    td2.text((pad + m2.width + gap - tb[0], ty), TEXT, font=font, fill=color + (255,))
    canvas = Image.alpha_composite(canvas, txt_layer)
    canvas.save(out_path)
    print("saved", out_path, canvas.size)


build_lockup(WHITE, f"{ASSETS}\\wth-logo-dark.png")
build_lockup(INK, f"{ASSETS}\\wth-logo-light.png")
print("ALL DONE")
