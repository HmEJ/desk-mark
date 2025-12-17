# 配置文件

在exe文件同级目录下创建 `config.json` 即可。

```json
{
  "text": "水印内容 ${time} ${date} ${username} ${hostname}",
  "angle": -45,
  "fontSize": 28,
  "gap": 180,
  "opacity": 0.15,
  "color": "#D8D8D8",
  "fontFamily": "SimSun"
}

```

支持的占位符：
- ${time} 
- ${date} 
- ${username} 
- ${hostname}

字体：
- "SimSun"
- "NSimSun"
- "SimHei"
- "Microsoft YaHei"
- "KaiTi"
- "FangSong"
- "Arial"
- "Times New Roman"