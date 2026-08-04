module.exports = {
  // ERP 登录信息
  ERP_URL: 'https://fx.fengsutb.com/',
  USERNAME: '17661602588',
  PASSWORD: 'Aa@123456',
  
  // 服务器端口
  PORT: process.env.PORT || 3000,
  
  // 浏览器设置
  // headless: true = 无界面模式（服务器推荐，但可能被ERP拦截）
  // headful: false = 有界面模式（需要服务器有图形界面）
  HEADLESS: process.env.HEADLESS !== 'false',
  
  // 自动更新间隔（分钟）
  UPDATE_INTERVAL: 30,
  
  // 数据文件路径
  DATA_FILE: 'data/orders.json'
};
