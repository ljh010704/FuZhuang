const fs = require('fs');

// 店铺分组统一来自 groups.js（同时供 index.html 与 express_stats.html 使用）
const { STORE_GROUPS } = require('./groups.js');

// 将最新数据写入 public/dashboard_data.js（外部数据文件）
// 数据外置后，index.html 不再内嵌订单，避免大数据撑爆文件/上下文。
var dataContent = fs.readFileSync('./dashboard_data.js', 'utf8');
var dataJson = dataContent.replace(/^const RAW_DATA = /, '').replace(/;\s*$/, '').trim();

var out = '// 看板数据文件：由 embed_data.js 自动生成，请勿手改\n' +
          '// 数据外置后，index.html 不再内嵌订单，文件体积大幅减小\n' +
          'window.RAW_DATA = ' + dataJson + ';\n' +
          'window.STORE_GROUPS = ' + JSON.stringify(STORE_GROUPS) + ';\n';
fs.writeFileSync('./public/dashboard_data.js', out, 'utf8');
console.log('数据已写入 public/dashboard_data.js');
console.log('文件大小:', out.length);
