# 涛哥帮帮忙 - 智能表格处理网站

一个现代化的静态网站，用于上传、预览和处理表格数据，支持导出为Excel文件。

## 功能特性

- 📁 **文件上传**：支持拖拽或点击上传多个Excel文件（.xlsx, .xls, .csv, .json）
- 📊 **表格预览**：实时预览上传的表格数据
- ✨ **智能处理**：根据输入要求处理表格数据
- 📤 **导出功能**：一键导出为Excel文件
- 🎨 **现代化界面**：深色主题，科技感设计

## 文件结构

```
表格处理网站/
├── index.html      # 主页面
├── styles.css      # 样式文件
├── script.js       # 功能脚本
└── README.md       # 说明文档
```

## 本地使用

1. 直接用浏览器打开 `index.html` 文件即可使用
2. 或者使用本地服务器运行（推荐）：

```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js (http-server)
npx http-server
```

然后在浏览器访问 `http://localhost:8000`

## 部署到 Gitee Pages

### 方法一：通过 Gitee 网页界面部署

1. **创建仓库**
   - 登录 Gitee
   - 点击右上角 "+" → "新建仓库"
   - 仓库名称：例如 `table-processor`
   - 设置为公开仓库
   - 点击"创建"

2. **上传文件**
   - 在仓库页面点击 "上传文件"
   - 将 `index.html`、`styles.css`、`script.js` 三个文件拖拽上传
   - 填写提交信息，点击"提交文件"

3. **开启 Gitee Pages**
   - 进入仓库的 "服务" → "Gitee Pages"
   - 部署分支选择：`master` 或 `main`
   - 部署目录：留空（根目录）
   - 点击 "启动"
   - 等待约1-2分钟，页面会显示访问地址

### 方法二：通过 Git 命令部署

```bash
# 1. 初始化 Git 仓库
git init

# 2. 添加文件
git add index.html styles.css script.js

# 3. 提交
git commit -m "初始提交"

# 4. 关联远程仓库（替换为你的仓库地址）
git remote add origin https://gitee.com/你的用户名/你的仓库名.git

# 5. 推送到 Gitee
git push -u origin master
```

然后按照方法一的第3步开启 Gitee Pages。

## 使用说明

1. **上传文件**：点击"选择文件"或直接拖拽文件到上传区域
2. **输入要求**：在文本框中输入你的处理要求
3. **生成预览**：点击"生成预览"按钮查看表格
4. **导出表格**：点击右下角的"📊 导出表格"按钮下载Excel文件

## 技术栈

- HTML5
- CSS3
- Vanilla JavaScript
- SheetJS (xlsx) - Excel文件处理库

## 注意事项

- 所有数据处理都在浏览器本地完成，不会上传到服务器
- 支持的文件格式：.xlsx, .xls, .csv, .json
- 建议使用现代浏览器（Chrome、Firefox、Edge、Safari）

## 许可证

MIT License
