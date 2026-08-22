# UPI Intent in the Android WebView

Handoff for the Android/frontend team. Covers why UPI does not appear in the
top-up flow and the two changes needed to fix it.

Decision on record: we are using **web Checkout inside the WebView**, not the
native Razorpay SDK.

---

## Why UPI is missing

UPI has three flows. On an Android phone, only one of them is available to us:

| Flow | Status |
|---|---|
| **Collect** (type the VPA by hand) | Retired by NPCI on 28 Feb 2026. Renders nothing. |
| **QR** | Shown automatically on desktop. On mobile it is not in the default set, but it **does** render when requested explicitly via `flows` — confirmed working on iOS with the config below. Needs nothing from the native wrapper. |
| **Intent** (tap a UPI app) | Available on mobile, but requires app-side support (Change 2). |

So the UPI block ends up empty when nothing is configured: collect is gone, QR
is not in the mobile default set, and intent needs native support we have not
built yet.

**Status:** with the `config.display.blocks` payload below, QR renders correctly
on iOS. It does not render on Android — same endpoint, same payload, same
Razorpay account. That localises the remaining bug to the Android client, and
makes Change 1 the first thing to check.

---

## What the backend already sends

`POST /api/v1/wallet/topup/order` returns everything Checkout needs. No backend
work is outstanding.

```jsonc
{
  "orderId": "order_XXXXXXXXXXXX",
  "amount": 10000,                  // paise
  "currency": "INR",
  "tokens": 100,
  "razorpayKeyId": "rzp_live_XXXXXXXX",
  "checkout": {
    "callback_url": "https://<api-host>/api/v1/wallet/topup/callback",
    "redirect": true,
    "webview_intent": true,
    "config": {
      "display": {
        "blocks": {
          "upi": {
            "name": "Pay using UPI",
            "instruments": [{ "method": "upi", "flows": ["intent", "qr"] }]
          }
        },
        "sequence": ["block.upi"],
        "preferences": { "show_default_blocks": true }
      }
    }
  }
}
```

Notes on that payload:

- `redirect: true` is required. In a WebView the JS `handler` callback is
  unreliable — the UPI intent hands control to the PSP app and the page that
  would have run the handler is gone. Checkout instead POSTs the result to
  `callback_url`, and we credit tokens server-side.
- `webview_intent: true` tells Checkout to emit the `upi:` / `intent:` URL.
- `qr` in `flows` is what makes the QR option appear on mobile — it is not in
  the default mobile set, so naming it explicitly is required. Verified on iOS.
- `show_default_blocks: true` keeps cards, netbanking and wallets visible
  below the UPI block. Do not set it to `false`.

---

## Change 1 — pass `checkout` through verbatim

**Start here — this is the most likely cause of the Android/iOS difference.**

The common failure: the app builds the Checkout options by hand and picks only
`orderId` / `amount` / `razorpayKeyId`. `config` and `webview_intent` then never
reach Razorpay and the UPI block stays empty. Since iOS renders UPI from the
same server payload and Android does not, the two clients are almost certainly
constructing these options differently.

Spread the whole object:

```js
const { orderId, amount, razorpayKeyId, checkout } = res.data.data;

const rzp = new Razorpay({
  key: razorpayKeyId,
  order_id: orderId,
  amount,
  currency: 'INR',
  name: 'IVS',
  prefill: { contact: user.mobile, email: user.email },
  ...checkout,          // callback_url, redirect, webview_intent, config
});

rzp.open();
```

Do not re-declare `callback_url`, `redirect`, `webview_intent` or `config`
after the spread — that silently overrides the server values.

> Server logs show `POST /api/v1/wallet/topup/order` arriving with a
> `Dalvik/2.1.0` user agent while every other API call arrives from the WebView
> (`…; wv) … Chrome/151`). That means this one request is made by native code or
> a native HTTP bridge, not by the web app. That is fine **provided** the
> response reaches the WebView JS above. Please confirm it does — if the native
> layer is instead constructing its own Checkout, none of this payload applies.

---

## Change 2 — handle the intent URL in the WebView

`webview_intent: true` only makes Checkout *emit* a `upi://` or `intent://`
URL. A WebView drops unknown schemes on the floor by default, so the tap does
nothing and Checkout suppresses the option. The native wrapper has to catch that
URL and hand it to the OS.

### Capacitor

The `http://localhost/` referer in our logs indicates Capacitor. Do **not**
replace the WebViewClient outright — Capacitor's `BridgeWebViewClient` handles
the local server and plugin routing. Subclass it and delegate:

```java
package in.grest.ivs;   // <- replace with the app's real package

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class UpiIntentWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;

    public UpiIntentWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();

        // Anything that is not http(s) is a PSP deep link: upi:, intent:,
        // phonepe:, tez:, paytmmp:, credpay: … Hand it to the OS.
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                bridge.getActivity().startActivityForResult(intent, 2001);
            } catch (ActivityNotFoundException ignored) {
                // No UPI app installed for this scheme; Checkout stays open.
            }
            return true;
        }

        // http(s) must fall through, or the redirect to callback_url never loads.
        return super.shouldOverrideUrlLoading(view, request);
    }
}
```

Register it:

```java
public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        getBridge().getWebView().setWebViewClient(new UpiIntentWebViewClient(getBridge()));
    }
}
```

### Plain WebView (no Capacitor)

Same logic, extending `WebViewClient` directly, plus these settings — Capacitor
sets them for you, a hand-rolled WebView does not:

```java
WebSettings s = webView.getSettings();
s.setJavaScriptEnabled(true);
s.setDomStorageEnabled(true);
```

### Careful with Razorpay's own sample

The sample in Razorpay's docs returns `true` unconditionally, for *every* URL
including `https://`. Copied as-is that blocks the redirect to `callback_url`
and leaves a blank screen after payment. It must return `false` (or defer to
`super`) for http/https, as above.

Do **not** add a `<queries>` block to the manifest for this. Package visibility
applies to the native SDK, which enumerates installed UPI apps. Web Checkout
renders a fixed list and `startActivity` with an implicit intent is not filtered.

---

## Blocker: cleartext HTTP on the callback

`callback_url` currently resolves to:

```
http://15.252.29.112:5000/api/v1/wallet/topup/callback
```

Android 9+ blocks cleartext HTTP by default. Once intent works, the user pays in
their UPI app, returns to Checkout, and the redirect POST to that URL fails
silently — payment taken, tokens not credited on screen. The webhook still
credits them server-side, but the user sees a failure.

Fix properly by putting the API behind HTTPS and setting `RAZORPAY_CALLBACK_URL`.
As a **testing-only** stopgap, allow cleartext for that host via a network
security config.

---

## Verifying

1. `POST /api/v1/wallet/topup/order` response is **larger than 315 bytes** —
   that is the pre-`config` payload size and a quick check that the current
   backend build is deployed.
2. Log the options object immediately before `rzp.open()`. `webview_intent`,
   `redirect`, `callback_url` and `config.display` must all be present.
3. Open the top-up flow on a device with at least one UPI app installed. The
   UPI block should be first, offering both a QR and a list of apps — compare
   directly against iOS, which already renders this correctly.
4. Tap an app. It should open with the amount pre-filled. If the QR shows but
   tapping an app does nothing, `shouldOverrideUrlLoading` is not firing —
   Change 1 landed and Change 2 has not.
5. Complete the payment and confirm the WebView lands on the result URL.
6. Server-side: `npm run payments:status` — the order should read
   `PAID … credited via client`. `CREATED` with no payment id means checkout
   opened and nothing completed.

---

## If intent still will not work

Razorpay's own guidance is that WebView is a supported-but-fragile path and
recommends migrating to the native Android SDK. Our backend already supports
that route via `POST /api/v1/wallet/topup/verify`, which takes the
`orderId` / `paymentId` / `signature` triplet from the SDK's success handler.
Going that way means dropping `redirect` / `callback_url` / `webview_intent`
and adding the `<queries>` manifest block.

---

## References

- [UPI Intent in WebView — Android](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/webview/upi-intent-android/)
- [About Webview for Mobile Apps](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/webview/)
- [UPI Intent](https://razorpay.com/docs/payments/payment-methods/upi/upi-intent/)
- [Understand the Configuration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/configure-payment-methods/understand-configuration/)
