const fs = require('fs');

// 将最新数据嵌入看板：只替换 public/index.html 里的 RAW_DATA 数据行，
// 保留看板现有的全部样式与交互（手机适配、旗帜选择器等）。

var dataContent = fs.readFileSync('./dashboard_data.js', 'utf8');
var dataJson = dataContent.replace(/^const RAW_DATA = /, '').replace(/;\s*$/, '').trim();

var html = fs.readFileSync('./public/index.html', 'utf8');
var re = /^const RAW_DATA = \[.*\];$/m;
if (!re.test(html)) {
  console.error('未找到 RAW_DATA 数据行，未做修改');
  process.exit(1);
}
html = html.replace(re, function() { return 'const RAW_DATA = ' + dataJson + ';'; });
fs.writeFileSync('./public/index.html', html, 'utf8');
console.log('数据已嵌入 public/index.html');
console.log('文件大小:', html.length);
