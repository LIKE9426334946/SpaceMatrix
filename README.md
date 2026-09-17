# SpaceMatrix

用小方块理解 1–4 维张量。主页面专注展示，`/admin` 管理形状、对象与索引高亮。方块表面没有数字。

## 功能

- 一维：方块横向排列；二维：方块组成平面；三维：方块组成一个立体；四维：第一维对应多个立体，自动分组排列。
- 自定义 1–4 个维度，每个维度 1–20，支持 `(20,20,20,20)`，共 160,000 个方块。
- 添加、编辑、删除多个对象；设置方块颜色与高亮颜色。
- Python 风格整数索引、切片、负索引、步长、省略号和多个区域。高亮时其他方块半透明，内部区域也可见。
- 拖动旋转、右键平移、滚轮或按钮缩放、全屏、重置视角；点击对象标签可以聚焦。
- 管理页输入生成本页预览，点击保存才写入服务器。已打开的展示页自动同步。
- JSON 文件持久化，重启不丢失对象。Three.js 使用本地 npm 包，不依赖外部 CDN 或字体。

## 页面与端口

| 用途         | 地址                               |
| ------------ | ---------------------------------- |
| 展示         | `http://服务器IP:16044/`           |
| 管理         | `http://服务器IP:16044/admin`      |
| 本机 Node.js | `http://127.0.0.1:3044/`           |
| 健康检查     | `http://127.0.0.1:3044/api/health` |

`/admin` 是直接访问的个人管理页面，没有用户账户或登录。

## Ubuntu 部署（root 用户）

项目固定放在 `/opt/SpaceMatrix`，公网通过 Nginx **16044** 访问，Node.js 只监听 **127.0.0.1:3044**，systemd 负责开机启动和异常重启。

### 1. 安装环境

需要 Node.js 22 或更新版本、npm、Git 和 Nginx。推荐 Node.js 24 LTS。

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg git nginx

# 已有 /usr/bin/node 且版本 >= 22 时，不需要重复安装 Node.js。
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh
bash /tmp/nodesource-setup.sh
apt-get install -y nodejs

node -v
npm -v
```

systemd 明确使用 `/usr/bin/node`，请确保该路径可用。

### 2. 获取项目

```bash
mkdir -p /opt/SpaceMatrix
git clone --branch main https://github.com/LIKE9426334946/SpaceMatrix.git /opt/SpaceMatrix
cd /opt/SpaceMatrix
```

如果目录中已有本项目，直接进入目录执行 `git pull --ff-only origin main`。

### 3. 安装并启动

```bash
cd /opt/SpaceMatrix
bash deploy/install.sh
```

脚本会安装依赖、创建以下配置并启动服务：

| 项目文件                        | 服务器位置                                |
| ------------------------------- | ----------------------------------------- |
| `deploy/SpaceMatrix.service`    | `/etc/systemd/system/SpaceMatrix.service` |
| `deploy/SpaceMatrix.nginx.conf` | `/etc/nginx/sites-available/SpaceMatrix`  |
| Nginx 启用链接                  | `/etc/nginx/sites-enabled/SpaceMatrix`    |

Nginx 含独立 `server` 块、转发头、WebSocket 升级头和实时同步需要的关闭缓冲设置。`Host` 保留端口。

也可以手动执行脚本对应步骤：

```bash
cd /opt/SpaceMatrix
npm ci --omit=dev
cp deploy/SpaceMatrix.service /etc/systemd/system/SpaceMatrix.service
cp deploy/SpaceMatrix.nginx.conf /etc/nginx/sites-available/SpaceMatrix
ln -sfn /etc/nginx/sites-available/SpaceMatrix /etc/nginx/sites-enabled/SpaceMatrix
nginx -t
systemctl daemon-reload
systemctl enable --now nginx
systemctl enable --now SpaceMatrix
systemctl reload nginx
```

### 4. 检查运行情况

```bash
systemctl status SpaceMatrix --no-pager
journalctl -u SpaceMatrix -n 50 --no-pager
curl http://127.0.0.1:3044/api/health
curl http://127.0.0.1:16044/api/health
```

在服务器安全组中开放 **TCP 16044**。如果启用了 UFW，再执行 `ufw allow 16044/tcp`。不需要开放 3044。

浏览器访问 `http://服务器IP:16044/`。

### 5. 更新代码

```bash
cd /opt/SpaceMatrix
git pull --ff-only origin main
bash deploy/install.sh
```

数据目录已加入 `.gitignore`，更新代码不会覆盖已保存的对象。

## 使用说明

1. 进入 `/admin`，点击加号添加对象。
2. 输入形状，例如 `6`、`4,5`、`(3,3,3)` 或 `2,3,3,3`。维度预设可快速切换。
3. 在索引框输入高亮区域，预览实时变化。
4. 点击“添加到场景”或“保存修改”，主页面自动更新。
5. 选中已有对象可继续修改；垃圾桶按钮删除对象，删除前会确认。

### 索引示例

以 `a.shape == (3,3,3)` 为例，索引从 0 开始：

| 表达式                 | 高亮区域                       | 方块数 |
| ---------------------- | ------------------------------ | -----: |
| `a[0, :, :]` 或 `a[0]` | 第一切片，左前方的面           |      9 |
| `a[:, 0, :]`           | 最上方的一层                   |      9 |
| `a[:, :, 0]`           | 最后一维的第一个位置           |      9 |
| `a[1, 1, 1]`           | 中心方块                       |      1 |
| `a[0:2, :, :]`         | 第一、第二切片                 |     18 |
| `a[-1, ...]`           | 最后一切片                     |      9 |
| `a[:, :, ::2]`         | 最后一维选择索引 0 和 2        |     18 |
| `a[::-1, :, :]`        | 反向遍历选中全部，空间位置不变 |     27 |
| `a[0]; a[-1]`          | 第一和最后切片的并集           |     18 |
| `a[1:1]`               | 空区域                         |      0 |

右边界不包含在切片中，越界切片按 Python 规则裁剪；越界的单个整数索引会报错。省略维度等价于 `:`。支持 `[0, :, :]` 或 `0, :, :` 等省略变量名的写法。

不支持布尔索引、索引数组、`None/newaxis` 或任意 Python 代码。多个区域用分号分隔，重叠只计一次。

对于四维 `(N,D,H,W)`，`a[0]` 选择第一个完整立体，`a[:,0,:,:]` 选择所有立体的第一面。多个立体按从左到右、从上到下排列，最后一行居中。索引只选择区域，不重新排列方块。

### 初始与重置视角

采用略高于张量的左前上方三分之四视角，正交相机保持方块尺寸一致：

| 三维索引          | 世界方向 | 初始画面中的方向 |
| ----------------- | -------- | ---------------- |
| `d0` / 第一个索引 | `+X`     | 左前 → 右后      |
| `d1` / 第二个索引 | `-Y`     | 上 → 下          |
| `d2` / 第三个索引 | `+Z`     | 左后 → 右前      |

相机方向固定为 `(-1.55,1.15,1.9)`，观察场景中心。第一切片在 `X` 最小的位置，位于画面左前且清晰可见。初始化与“重置视角”使用同一函数恢复角度、居中和适配缩放。多个对象时重置显示整个场景；点击标签可聚焦单个对象。

一维沿初始屏幕水平方向排列，二维按行向下、按列水平形成平面。四维的每个立体沿用三维方向。

## 数据与备份

首次运行创建 `backend/data/scene.json`，初始对象是 `(3,3,3)`，高亮 `a[0,:,:]`。保存时写入临时文件再原子替换，写请求顺序处理。

```bash
# 备份到自己指定的位置
cp /opt/SpaceMatrix/backend/data/scene.json /root/SpaceMatrix-scene-backup.json

# 恢复前停止服务，替换后启动
systemctl stop SpaceMatrix
cp /root/SpaceMatrix-scene-backup.json /opt/SpaceMatrix/backend/data/scene.json
systemctl start SpaceMatrix
```

开发时可用 `DATA_DIR` 指定其他数据目录；`HOST`、`PORT` 可覆盖本机运行参数。正式部署使用提供的 systemd 配置。

## 本地运行与验证

```bash
npm ci
npm test
npm start
```

打开 `http://127.0.0.1:3044/` 或 `/admin`。无需构建步骤。浏览器需要 WebGL2，建议开启硬件加速；四维满尺寸和大量对象的流畅度取决于设备性能。使用实例化绘制，并只在交互或状态变化时重绘。

自动测试覆盖索引语义、维度上限、切片方向、接口增删改、同步事件、无效数据拒绝和重启持久化。

## 目录

- `backend/server.js`：Node.js 服务、JSON 持久化、对象接口与同步。
- `public/index.html`、`styles.css`、`app.js`：展示与管理界面。
- `public/viewer.js`：Three.js 绘制、相机和控制。
- `public/tensor.js`：前后端共用的形状和索引解析。
- `public/layout.js`：各维度空间布局。
- `deploy/`：Nginx、systemd 配置和安装脚本。
- `tests/`：核心逻辑与接口测试。
