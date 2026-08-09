module.exports = {
  // ERP 登录信息
  ERP_URL: 'https://fx.fengsutb.com/',
  USERNAME: '17661602588',
  PASSWORD: 'Aa@123456',

  // 服务器端口
  PORT: process.env.PORT || 3000,

  // 自动拉取订单间隔（分钟）：服务器直接调 ERP HTTP 接口，无需浏览器
  POLL_INTERVAL: 2
};
