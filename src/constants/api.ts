/** Yodobashi API endpoints — same as YodoTool api_extracted.js */

export const BASE_ORDER = 'https://order.yodobashi.com';
export const BASE_WWW = 'https://www.yodobashi.com';
export const BASE_TOKEN = 'https://tokenize.yodobashi.com';

export const API = {
  login:
    'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F%3Flogout%3Dtrue%26yclogout%3Dtrue',
  getAccessToken: 'https://order.yodobashi.com/yc/ts/getAccessToken.html',
  decryptPanToken: 'https://order.yodobashi.com/yc/ts/decryptPanToken.html',
  tokenize: 'https://tokenize.yodobashi.com/yc/credit/v1/Tokenize',

  mypageIndex: 'https://order.yodobashi.com/yc/mypage/index.html',
  memberIndex: 'https://order.yodobashi.com/yc/mypage/member/index.html',
  cardDelete: 'https://order.yodobashi.com/yc/mypage/card/delete.html',

  cartIndex: 'https://order.yodobashi.com/yc/shoppingcart/index.html?next=true',
  cartAction: 'https://order.yodobashi.com/yc/shoppingcart/action.html',
  cartAdd: 'https://order.yodobashi.com/yc/shoppingcart/add/index.html',
  cartLeterBuy: 'https://order.yodobashi.com/yc/shoppingcart/ajax/leterBuy.html',
  cartRecommend: 'https://order.yodobashi.com/yc/shoppingcart/recommend.html',
  cartReturnMember:
    'https://order.yodobashi.com/yc/shoppingcart/index.html?returnUrl=https%3A%2F%2Forder.yodobashi.com%2Fyc%2Fmypage%2Fmember%2Findex.html',
  cartReturnHome:
    'https://order.yodobashi.com/yc/shoppingcart/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F',

  orderIndex: 'https://order.yodobashi.com/yc/order/index.html',
  orderConfirmIndex:
    'https://order.yodobashi.com/yc/order/confirm/index.html?nodeStateKey=',
  orderConfirmAction: 'https://order.yodobashi.com/yc/order/confirm/action.html',
  orderDeliveryChange:
    'https://order.yodobashi.com/yc/order/confirm/ajax/deliveryChange.html',
  orderPaymentIndex:
    'https://order.yodobashi.com/yc/order/payment/index.html?nodeStateKey=',
  orderPaymentAction: 'https://order.yodobashi.com/yc/order/payment/action.html',
  orderReinputIndex:
    'https://order.yodobashi.com/yc/order/reinputcredit/index.html?nodeStateKey=',
  orderReinputAction:
    'https://order.yodobashi.com/yc/order/reinputcredit/action.html',
  orderComplete:
    'https://order.yodobashi.com/yc/order/complete/index.html?nodeStateKey=',
  orderHistory: 'https://order.yodobashi.com/yc/orderhistory/index.html',

  getPublicIp: 'https://api.ipify.org/?format=txt',
  productBase: 'https://www.yodobashi.com/product/',
} as const;

export const SELECTORS = {
  cardNo: '.cardNoC',
  cartInSKU: '.cartInSKU',
  deliveryDateSelect: '.deliveryDateSelect',
  deliveryDateTypeSelect: '.deliveryDateTypeSelect',
  deliveryMethodSelect: '.deliveryMethodSelect',
  paymentTypeCode: '.paymentTypeCode',
  creditCardIndex: 'creditCard.paymentNumberIndex',
  creditCardCVV: 'creditCard.securityCode',
  postCode: '.postCodeC',
} as const;

export const PAYMENT_FIELDS = {
  paymentTypeCode: 'paymentTypeCode',
  paymentTypeCode0: 'paymentTypeCode0',
  pointPaymentTypeCode: 'pointPaymentTypeCode',
  orderPayment: 'orderPayment',
  selectCredit: 'selectCredit',
  cardNumber: 'cardNumber',
  panToken: 'panToken',
  postToken: 'postToken',
  detailNo: 'detailNo',
  amount: 'amount',
  editable: 'editable',
} as const;

export const HEADERS = {
  json: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  form: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  html: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'ja-JP,ja;q=0.9',
  },
} as const;

/**
 * Exact workflow order from YodoTool handle.jsc / api_extracted.js
 */
export const WORKFLOW_STEPS = [
  'getGoYodoHome',
  'callMemberIndex',
  'getAccessToken',
  'callAkamaiScript',
  'callApiAddCart',
  'callNextCart',
  'callApiLeterBuy',
  'callGetOrderIndex',
  'callGetConfirm',
  'getDelivery',
  'callPostConfirm',
  'callGetpaymentIndex',
  'getPanToken',
  'decryptPanToken',
  'postTokenize',
  'callPostPayment',
  'callPaymentNext',
  'callReinputCredit',
  'callOrderNext',
  'callOrderhistory',
] as const;
