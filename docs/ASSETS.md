# 图片与图标

图片沿用报告对应网页项目的四个素材，来源为 Wikimedia Commons。2026-10-08 通过原文件页或官方 imageinfo/extmetadata API 核对作者及许可，下载后等比例缩小至 720 像素宽，JPEG 质量 82。图片自身按原许可提供，显示时 `aspectFill` 裁切；没有对图片添加新识别名称或修改主体。

| 本地文件 | 摄影作者 | 许可 | 原文件 |
| --- | --- | --- | --- |
| `miniprogram/images/botanical/flowers.jpg` | GPAMWKM Woodsz ABA | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [白菊花](https://commons.wikimedia.org/wiki/File:HK_Chinese_herbal_medicines_杭州_白菊花_White_Chrysanthemum_涼茶_Chinese_herb_teas_September_2025_R12S_01.jpg) |
| `miniprogram/images/botanical/orange.jpg` | Mcwong226 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Chenpi2432016.jpg](https://commons.wikimedia.org/wiki/File:Chenpi2432016.jpg) |
| `miniprogram/images/botanical/berries.jpg` | Myrabella / Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Goji dried berries.jpg](https://commons.wikimedia.org/wiki/File:Goji_dried_berries.jpg) |
| `miniprogram/images/botanical/garden.jpg` | Mk2010 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Chinese Herb Garden](https://commons.wikimedia.org/wiki/File:Tung_Chung_North_Park,_Chinese_Herb_Garden_(Hong_Kong).jpg) |

小程序“我的 → 关于百草源”展示上述署名与许可，提供复制原文件和许可链接的按钮。缩小与压缩后的图片继续按相同许可提供。发布时请保留此说明和应用内署名。

页面图标由 `miniprogram/data/ui-icons.js` 维护，采用统一的 24×24 SVG 画布、1.65px 线宽、圆端点和圆转角，共 20 种原创线条图形。`app-icon` 使用经过编码的 SVG data URI，可按实际传入颜色显示，无需网络或图标字体。图标比例与线条一致性参考 [Lucide 官方图标规范](https://lucide.dev/contribute/icons/specification)，图形为本项目自行绘制。

原生底部标签栏继续使用 `miniprogram/images/ui/` 下的透明 PNG 线条图标（72×72），由 `scripts/generate-icons.ps1` 生成，保持原生导航的兼容性。

功能标题与正文使用系统字体，宋体/仿宋保留给古籍名称与阅读内容，没有打包第三方字体文件。
