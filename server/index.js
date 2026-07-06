const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5332;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Droplink running on port ${PORT}`);
  console.log(`  Admin panel : http://localhost:${PORT}/admin`);
  console.log(`  Public links: http://localhost:${PORT}/t/:slug`);
});
