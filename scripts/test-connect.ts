import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { testProxy } from '../src/client/session.js';

const proxy = {
  host: '74.81.32.177',
  port: 7700,
  username: 'hipksz',
  password: 'oxtemsuy',
};

async function main() {
  console.log('1. testProxy helper');
  const t0 = Date.now();
  const r = await testProxy(proxy);
  console.log('   ', r, `(${Date.now() - t0}ms)`);

  console.log('2. Direct yodobashi');
  try {
    const t1 = Date.now();
    const res = await axios.get('https://www.yodobashi.com/', {
      timeout: 20_000,
      validateStatus: () => true,
    });
    console.log('   status', res.status, `(${Date.now() - t1}ms)`);
  } catch (e) {
    console.log('   FAIL', e instanceof Error ? e.message : e);
  }

  console.log('3. Yodobashi via proxy (raw agent)');
  const url = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.host}:${proxy.port}`;
  const agent = new HttpsProxyAgent(url, { timeout: 60_000 });
  try {
    const t2 = Date.now();
    const res = await axios.get('https://www.yodobashi.com/', {
      timeout: 60_000,
      httpsAgent: agent,
      httpAgent: agent,
      validateStatus: () => true,
    });
    console.log('   status', res.status, `(${Date.now() - t2}ms)`);
  } catch (e) {
    console.log('   FAIL', e instanceof Error ? e.message : e);
  }
}

main().catch(console.error);
