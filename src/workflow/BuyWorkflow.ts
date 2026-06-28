import { API, BASE_WWW, HEADERS } from '../constants/api.js';
import { browserLogin } from '../client/browserLogin.js';
import { YodoSession, testProxy } from '../client/session.js';
import {
  extractNodeStateKey,
  extractNodeStateKeyFromHtml,
  findFormAction,
  isLoggedInHtml,
  isOrderCompleteHtml,
  parseHiddenFormFields,
  resolveUrl,
} from '../lib/html.js';
import { emitLog, nowTime } from '../lib/logger.js';
import type {
  Account,
  ProxyConfig,
  StepResult,
  WorkflowContext,
  WorkflowFlags,
} from '../types.js';

export interface BuyWorkflowOptions {
  taskId: string;
  account: Account;
  productId: string;
  amount: number;
  proxy?: ProxyConfig;
  flags: WorkflowFlags;
  saveCard: boolean;
  fingerprint?: string;
  signal?: AbortSignal;
  onStep?: (step: string) => void;
}

export class BuyWorkflow {
  readonly session: YodoSession;
  readonly ctx: WorkflowContext;
  readonly signal?: AbortSignal;
  private readonly onStep?: (step: string) => void;

  constructor(opts: BuyWorkflowOptions) {
    this.session = new YodoSession(opts.proxy);
    this.signal = opts.signal;
    this.onStep = opts.onStep;
    this.ctx = {
      taskId: opts.taskId,
      account: opts.account,
      productId: opts.productId,
      amount: opts.amount,
      flags: opts.flags,
      saveCard: opts.saveCard,
      fingerprint: opts.fingerprint,
      loggedIn: false,
    };
  }

  private checkAbort(): void {
    if (this.signal?.aborted) throw new Error('Stopped');
  }

  private async stepDelay(): Promise<void> {
    if (this.ctx.flags.IS_RUN_SLOW) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    } else if (this.ctx.flags.TIME_WAIT > 0) {
      await new Promise((r) => setTimeout(r, this.ctx.flags.TIME_WAIT));
    }
  }

  private log(step: string, message: string, level: 'info' | 'step' | 'success' | 'error' = 'step') {
    emitLog(this.ctx.taskId, this.ctx.account.email, level, `${message}: ${nowTime()}`, step);
  }

  private async runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
    this.checkAbort();
    this.onStep?.(step);
    this.log(step, `→ ${step}...`, 'info');
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(step, `failed — ${msg}`, 'error');
      throw err;
    }
  }

  private validateAccount(): boolean {
    const card = this.ctx.account.cardNumber.replace(/\s/g, '');
    if (!/^\d{13,19}$/.test(card)) {
      this.log(
        'validate',
        `Invalid card "${this.ctx.account.cardNumber}" — use: email password card month year cvv`,
        'error',
      );
      return false;
    }
    return true;
  }

  // ─── Phase 1: session warmup + login (before scheduled buy time) ───

  async getGoYodoHome(): Promise<StepResult> {
    const res = await this.session.get(BASE_WWW + '/');
    return { ok: res.status < 400, data: { html: res.data.slice(0, 200) } };
  }

  async callMemberIndex(): Promise<StepResult> {
    const res = await this.session.get(API.memberIndex);
    const loggedIn = isLoggedInHtml(res.data);
    if (loggedIn) this.ctx.loggedIn = true;
    return { ok: res.status < 400, data: { loggedIn: String(loggedIn) } };
  }

  async getAccessToken(): Promise<StepResult> {
    const res = await this.session.get(API.getAccessToken, { headers: HEADERS.json });
    try {
      const json = JSON.parse(res.data) as { accessToken?: string };
      if (json.accessToken) this.ctx.accessToken = json.accessToken;
      return { ok: !!json.accessToken, data: { accessToken: json.accessToken ?? '' } };
    } catch {
      return { ok: false, error: 'getAccessToken parse failed' };
    }
  }

  async callAkamaiScript(scriptUrl?: string): Promise<StepResult> {
    if (!scriptUrl) {
      const home = await this.session.get(BASE_WWW + '/');
      const m = home.data.match(/src="(\/[^"]*akam[^"]*\.js[^"]*)"/i);
      scriptUrl = m ? resolveUrl(BASE_WWW, m[1]) : undefined;
    }
    if (!scriptUrl) return { ok: true };
    const res = await this.session.get(scriptUrl);
    return { ok: res.status < 400 };
  }

  async login(): Promise<StepResult> {
    const loginPage = await this.session.get(API.login);
    const fields = parseHiddenFormFields(loginPage.data);
    fields['loginId'] = this.ctx.account.email;
    fields['password'] = this.ctx.account.password;
    const action = findFormAction(loginPage.data, 'login') ?? API.login;
    const postUrl = resolveUrl(API.login, action);
    const res = await this.session.post(postUrl, fields);
    const member = await this.session.get(API.memberIndex);
    const ok = isLoggedInHtml(member.data);
    this.ctx.loggedIn = ok;
    return { ok, error: ok ? undefined : 'login failed' };
  }

  /** Pre-buy: steps 1–4 + login */
  async runLoginPhase(): Promise<boolean> {
    if (!this.validateAccount()) return false;
    this.log('start', `start ${this.ctx.account.email}`, 'info');

    if (this.session.proxy) {
      this.onStep?.('checkProxy');
      this.log('checkProxy', 'Checking proxy...', 'info');
      const check = await testProxy(this.session.proxy);
      if (!check.ok) {
        this.log('checkProxy', `error checkProxy: ${check.error}`, 'error');
        return false;
      }
      this.log('checkProxy', `proxy ok — IP ${check.ip}`, 'info');
    }

    this.onStep?.('browserLogin');
    this.log('browser', 'Starting browser login (Akamai bypass)...', 'info');
    const browserResult = await browserLogin(this.session, this.ctx.account, this.session.proxy);
    if (browserResult.ok) {
      this.ctx.loggedIn = true;
      await this.runStep('getAccessToken', () => this.getAccessToken());
      this.log('login', `browser login success ${this.ctx.account.email}`, 'success');
      return true;
    }
    this.log('browser', `browser failed: ${browserResult.error} — trying HTTP fallback`, 'info');

    await this.runStep('getGoYodoHome', () => this.getGoYodoHome());
    await this.stepDelay();
    await this.runStep('callMemberIndex', () => this.callMemberIndex());
    await this.runStep('getAccessToken', () => this.getAccessToken());
    await this.runStep('callAkamaiScript', () => this.callAkamaiScript());
    const login = await this.runStep('login', () => this.login());
    if (login.ok) {
      this.log('login', `login success ${this.ctx.account.email}`, 'success');
      return true;
    }
    this.log(
      'login',
      `login failed ${this.ctx.account.email} — check Japan proxy and run on Windows if blocked`,
      'error',
    );
    return false;
  }

  // ─── Phase 2: buy at scheduled time (exact YodoTool order from logs) ───

  async callApiAddCart(): Promise<StepResult> {
    const productUrl = `${API.productBase}${this.ctx.productId}/`;
    await this.session.get(productUrl);
    const fields: Record<string, string> = {
      goods: this.ctx.productId,
      jsSitePath: 'yc',
      qty: String(this.ctx.amount),
    };
    const res = await this.session.post(API.cartAdd, fields);
    const loc = this.session.location(res) ?? res.data.match(/location\.href\s*=\s*['"]([^'"]+)/)?.[1];
    this.log('callApiAddCart', `callApiAddCart location ${loc ?? res.status}`);
    return { ok: res.status < 400 || !!loc, nextUrl: loc };
  }

  async callNextCart(): Promise<StepResult> {
    const res = await this.session.get(API.cartIndex);
    this.log('callNextCart', `callNextCart ${this.ctx.account.email}`);
    return { ok: res.status < 400 };
  }

  async callApiLeterBuy(): Promise<StepResult> {
    const res = await this.session.post(API.cartLeterBuy, {});
    return { ok: res.status < 500 };
  }

  async callPayment(): Promise<StepResult> {
    const cart = await this.session.get(API.cartIndex);
    const action = findFormAction(cart.data, 'action.html') ?? API.cartAction;
    const fields = parseHiddenFormFields(cart.data);
    fields['next'] = 'true';
    const res = await this.session.post(resolveUrl(API.cartIndex, action), fields);
    const loc = this.session.location(res);
    this.log('callPayment', `callPayment ${this.ctx.account.email}`);
    this.log('callPayment', `callPayment location: ${loc ?? 'inline'}`);
    return { ok: res.status < 400, nextUrl: loc };
  }

  async callGetOrderIndex(): Promise<StepResult> {
    let res = await this.session.get(API.orderIndex);
    let loc = this.session.location(res);
    let html = res.data;
    if (loc) {
      res = await this.session.get(resolveUrl(API.orderIndex, loc));
      html = res.data;
      loc = this.session.location(res) ?? loc;
    }
    const finalUrl = loc ?? API.orderIndex;
    this.log('callGetOrderIndex', `callGetOrderIndex ${this.ctx.account.email}`);
    this.log('callGetOrderIndex', `callGetOrderIndex: ${finalUrl}`);
    const key = extractNodeStateKey(finalUrl) ?? extractNodeStateKeyFromHtml(html);
    if (key) this.ctx.nodeStateKey = key;
    return { ok: !!key || res.status < 400, nextUrl: finalUrl, data: { path: finalUrl } };
  }

  async getReinputIndex(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const url = API.orderReinputIndex + this.ctx.nodeStateKey;
    const res = await this.session.get(url);
    this.log('getReinputIndex', 'getReinputIndex');
    return { ok: res.status < 400 };
  }

  async callReinputCredit(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const indexUrl = API.orderReinputIndex + this.ctx.nodeStateKey;
    const page = await this.session.get(indexUrl);
    const fields = parseHiddenFormFields(page.data);
    fields['creditCard.securityCode'] = this.ctx.account.cvv;
    const action = findFormAction(page.data) ?? API.orderReinputAction;
    const res = await this.session.post(resolveUrl(indexUrl, action), fields);
    this.log('callReinputCredit', 'callReinputCredit');
    return { ok: res.status < 400 };
  }

  async callOrderNext(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const res = await this.session.get(API.orderConfirmIndex + this.ctx.nodeStateKey);
    this.log('callOrderNext', 'callOrderNext');
    return { ok: res.status < 400 };
  }

  async callGetConfirm(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const url = API.orderConfirmIndex + this.ctx.nodeStateKey;
    const res = await this.session.get(url);
    this.log('callGetConfirm', `start callGetConfirm ${this.ctx.account.email}`);
    return { ok: res.status < 400 };
  }

  async getDelivery(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const confirmUrl = API.orderConfirmIndex + this.ctx.nodeStateKey;
    const page = await this.session.get(confirmUrl);
    const fields = parseHiddenFormFields(page.data);
    const res = await this.session.post(API.orderDeliveryChange, fields, {
      headers: { ...HEADERS.json, 'X-Requested-With': 'XMLHttpRequest' },
    });
    this.log('getDelivery', 'start getDelivery');
    return { ok: res.status < 400 };
  }

  async callPostConfirm(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const confirmUrl = API.orderConfirmIndex + this.ctx.nodeStateKey;
    const page = await this.session.get(confirmUrl);
    const fields = parseHiddenFormFields(page.data);
    const res = await this.session.post(API.orderConfirmAction, fields);
    this.log('callPostConfirm', `start callPostConfirm ${this.ctx.account.email}`);
    const key = extractNodeStateKey(this.session.location(res) ?? '') ?? this.ctx.nodeStateKey;
    if (key) this.ctx.nodeStateKey = key;
    return { ok: res.status < 400 };
  }

  async callGetpaymentIndex(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const url = API.orderPaymentIndex + this.ctx.nodeStateKey;
    const res = await this.session.get(url);
    this.log('callGetpaymentIndex', 'callGetpaymentIndex');
    return { ok: res.status < 400 };
  }

  async getPanToken(): Promise<StepResult> {
    return this.getAccessToken();
  }

  async decryptPanToken(panToken: string): Promise<StepResult> {
    const res = await this.session.postJson(API.decryptPanToken, { panToken });
    return { ok: res.status < 400 };
  }

  async postTokenize(): Promise<StepResult> {
    const tokenRes = await this.getAccessToken();
    if (!tokenRes.ok || !this.ctx.accessToken) return { ok: false, error: 'no access token' };
    const body = {
      cardNumber: this.ctx.account.cardNumber,
      cardExpire: `${this.ctx.account.cardMonth}${this.ctx.account.cardYear.slice(-2)}`,
      securityCode: this.ctx.account.cvv,
      accessToken: this.ctx.accessToken,
    };
    const res = await this.session.postJson(API.tokenize, body);
    try {
      const json = JSON.parse(res.data) as { panToken?: string };
      if (json.panToken) this.ctx.paymentDetails = { panToken: json.panToken };
      return { ok: !!json.panToken };
    } catch {
      return { ok: false, error: 'tokenize failed' };
    }
  }

  async callPostPayment(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const payUrl = API.orderPaymentIndex + this.ctx.nodeStateKey;
    const page = await this.session.get(payUrl);
    const fields = parseHiddenFormFields(page.data);
    fields['paymentTypeCode'] = fields['paymentTypeCode'] || '10';
  if (this.ctx.paymentDetails?.panToken) {
      fields['panToken'] = this.ctx.paymentDetails.panToken;
    }
    fields['creditCard.securityCode'] = this.ctx.account.cvv;
    this.log('callPostPayment', `start callPostPayment ${this.ctx.account.email}`);
    const res = await this.session.post(API.orderPaymentAction, fields);
    return { ok: res.status < 400, nextUrl: this.session.location(res) };
  }

  async callPaymentNext(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const url = API.orderReinputIndex + this.ctx.nodeStateKey;
    const res = await this.session.get(url);
    this.log('callPaymentNext', 'start callPaymentNext');
    const loc = this.session.location(res);
    if (!loc && !res.data) return { ok: false, error: 'Invalid URL' };
    return { ok: res.status < 400, nextUrl: loc };
  }

  async callComplete(): Promise<StepResult> {
    if (!this.ctx.nodeStateKey) return { ok: false, error: 'no nodeStateKey' };
    const url = API.orderComplete + this.ctx.nodeStateKey;
    const res = await this.session.get(url);
    this.log('callComplete', `start callComplete ${this.ctx.account.email}`);
    const ok = isOrderCompleteHtml(res.data) || res.status < 400;
    return { ok };
  }

  async callOrderhistory(): Promise<StepResult> {
    const res = await this.session.get(API.orderHistory);
    return { ok: res.status < 400 && res.data.includes('注文') };
  }

  /**
   * Buy phase — matches YodoTool log sequence:
   * addCart → nextCart → payment → orderIndex → (reinput branch | confirm branch) → complete
   */
  async runBuyPhase(): Promise<boolean> {
    this.checkAbort();
    this.log('buy', `start buy ${this.ctx.account.email}`, 'info');

    if (this.ctx.flags.USE_OLD_CARD && this.ctx.flags.HAVE_SAVE_CARD) {
      // saved card path — skip tokenize when possible
    }

    await this.callApiAddCart();
    await this.callNextCart();
    await this.callPayment();
    const orderIdx = await this.callGetOrderIndex();
    const path = orderIdx.nextUrl ?? orderIdx.data?.path ?? '';

    if (path.includes('reinputcredit')) {
      await this.getReinputIndex();
      await this.callReinputCredit();
      await this.callOrderNext();
    } else if (path.includes('payment')) {
      await this.callGetpaymentIndex();
      await this.getPanToken();
      await this.postTokenize();
      const pay = await this.callPostPayment();
      if (!pay.ok) {
        await this.callPaymentNext();
      }
    } else if (path.includes('address')) {
      await this.callGetpaymentIndex();
      await this.postTokenize();
      await this.callPostPayment();
    }

    await this.callGetConfirm();
    await this.getDelivery();
    await this.callPostConfirm();
    const done = await this.callComplete();
    if (!done.ok) {
      await this.callOrderhistory();
    }

    const success = done.ok;
    this.log('buy', `buy success ${this.ctx.account.email} ${success}`, success ? 'success' : 'error');
    emitLog(this.ctx.taskId, this.ctx.account.email, success ? 'success' : 'error', `success:${success}`);
    return success;
  }
}
