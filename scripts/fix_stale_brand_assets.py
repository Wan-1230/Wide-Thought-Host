# 一次性补丁脚本：让遗漏的品牌资源与新 logo 对齐。
# - 从 icons/icon-master.png 重新生成 icons/256x256.png
# - 基于新符号重建 ChatView 空状态横幅 wth-banner.png（深/浅通用：白色符号+字标，UI 侧用 .theme-logo 反色）
from PIL import Image, ImageDraw, ImageFont

ICONS = r"d:\gork\wth\crates\desktop\wth-desktop\icons"
ASSETS = r"d:\gork\wth\crates\desktop\wth-desktop\ui\src\assets"

WHITE = (255, 255, 255)
INK = (26, 26, 26)  # 横幅用近黑：浅色主题直接显示，深色主题由 .theme-logo CSS invert 反白
FONT_PATH = r"C:\Windows\Fonts\seguisb.ttf"
TEXT = "Wide Thought Host"

# 1) 256x256 应用图标（由新母版缩放）
master = Image.open(f"{ICONS}\\icon-master.png").convert("RGBA")
master.resize((256, 256), Image.LANCZOS).save(f"{ICONS}\\256x256.png")
print("saved 256x256.png")

# 2) 空状态横幅：近黑符号 + 字标，透明底（深色模式由 CSS 反色）
mark = Image.open(f"{ASSETS}\\wth-mark.png").convert("RGBA")
# wth-mark.png 为白色符号，此处染成近黑
ink_mark = Image.new("RGB", mark.size, INK)
ink_mark.putalpha(mark.getchannel("A"))
mark = ink_mark
font = ImageFont.truetype(FONT_PATH, 150)
tmp = Image.new("RGBA", (10, 10))
td = ImageDraw.Draw(tmp)
tb = td.textbbox((0, 0), TEXT, font=font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]

mark_h = 260
m = mark.copy()
m.thumbnail((mark_h, mark_h), Image.LANCZOS)
gap = 64
pad = 40
canvas_w = pad + m.width + gap + tw + pad
canvas_h = pad + max(m.height, th) + pad
canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
canvas.paste(m, (pad, (canvas_h - m.height) // 2), m)

txt_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
td2 = ImageDraw.Draw(txt_layer)
ty = (canvas_h - th) // 2 - tb[1]
td2.text((pad + m.width + gap - tb[0], ty), TEXT, font=font, fill=INK + (255,))
canvas = Image.alpha_composite(canvas, txt_layer)
canvas.save(f"{ASSETS}\\wth-banner.png")
print("saved wth-banner.png", canvas.size)
print("ALL DONE")
