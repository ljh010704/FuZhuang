const fs = require('fs');

// 店铺分组（唯一来源，同时供 index.html 与 express_stats.html 使用）
const STORE_GROUPS = {"李1":["长沙雨花区鱼乎青百货商行（个人独资）企业店","苏洛寻海犹女装专卖店","苏洛寻琼海服装专卖店","HKML鱼乎女装专卖店","苏洛寻犹定服装专卖店","苏洛寻海犹服饰专卖店","琼海犹定商贸行（个人独资）企业店"],"李2":["永春县塑研贸易商行（个人独资）805企业店","上和隆研服饰专卖店","永春县塑研贸易商行（个人独资）企业店","上和隆塑研服饰专卖店","上和隆塑服饰专卖店"],"李3":["吉公堂贸易服饰专卖店","吉公堂里贸服饰专卖店","吉公堂里贸服装专卖店","吉公堂虽里女装专卖店","吉公堂虽里服装专卖店"]};

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
