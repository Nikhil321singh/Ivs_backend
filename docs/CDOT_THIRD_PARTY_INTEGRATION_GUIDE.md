# C-DOT IMEI Verification Integration Guide

**For Third-Party Vendors & Integration Partners**

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [API Authentication](#api-authentication)
4. [Pricing & Wallet Model](#pricing--wallet-model)
5. [API Endpoints](#api-endpoints)
6. [Integration Examples](#integration-examples)
7. [Error Handling](#error-handling)
8. [Support & Contact](#support--contact)

---

## Overview

The C-DOT IMEI Verification API allows third-party vendors to verify device IMEIs against India's Central Equipment Identity Register (CEIR) managed by the Department of Telecommunications (C-DOT).

### Key Features

- **Real-time IMEI Verification** - Instant blacklist/blocklist status checks
- **Wallet-Based Billing** - Pay-per-use model at ₹19 per IMEI check
- **Atomic Transactions** - Secure wallet debits with full audit trail
- **Comprehensive Logging** - Track all verification attempts and results
- **Dashboard Access** - Manage wallet, view analytics, and API usage

### Use Cases

- Device procurement verification
- Refurbished device validation
- Auction platform integration
- Inventory verification systems
- Custom business applications

---

## Getting Started

### Step 1: Register as a Vendor

Contact our team to register as a C-DOT vendor partner:

```
Email: support@grest.in
Subject: C-DOT Vendor Registration Request
```

Provide:
- Company name
- Contact person name & phone
- Email address
- Business description
- Expected monthly API call volume

### Step 2: Account Setup

Once approved, you will receive:

- **Vendor Dashboard** login credentials
- **API Key** (format: `cdot_<random_string>`)
- **Initial Wallet Balance** (optional)
- **Documentation & Support Contact**

### Step 3: Wallet Top-Up (Optional)

Top up your wallet balance through:

1. **Vendor Dashboard** - Add credits via bank transfer
2. **Admin Portal** - Request initial balance setup
3. **Pay-Per-Use** - Auto-deduct from wallet at ₹19 per check

---

## API Authentication

### Authentication Method

All requests to the C-DOT wrapper endpoint must include an **X-API-Key** header.

```
X-API-Key: cdot_<your_api_key>
```

### Security Requirements

- **API Keys** are sensitive - keep them secure and confidential
- **Do NOT** commit API keys to version control
- **Do NOT** expose API keys in frontend code
- Store API keys in environment variables or secure vaults
- Rotate keys annually or on compromise

### Rate Limiting

- **Rate Limit**: 100 requests per minute per API key
- **Daily Limit**: 10,000 requests per day
- **Burst Protection**: Temporary blocks on excessive usage
- Contact support for higher limits

---

## Pricing & Wallet Model

### Cost Per Check

| Check Type | Cost | Currency |
|-----------|------|----------|
| IMEI Verification | ₹19 | INR (Paise: 1900) |

### Wallet Management

Your wallet is stored securely in our database with:

- **Current Balance** - Always current, checked before each request
- **Transaction History** - Complete audit trail of all debits/credits
- **Top-Up Options** - Bank transfer, razorpay, or admin-initiated
- **Refund Policy** - Failed checks return ₹19 to wallet

### Example Calculation

```
Initial Balance: ₹1,000 (100,000 paise)

Check 1: IMEI 356284535498141 → ✓ Success (-₹19)
Balance: ₹981

Check 2: IMEI 123456789012345 → ✓ Success (-₹19)
Balance: ₹962

Check 3: IMEI 999999999999999 → ✗ Failed (refunded +₹19)
Balance: ₹981
```

### Insufficient Balance

If wallet balance drops below ₹19:
- Request returns **403 Forbidden**
- Error: `INSUFFICIENT_WALLET_BALANCE`
- Top up immediately to resume checks
- No charges for failed requests

---

## API Endpoints

### Base URL

```
https://business.grest.in/api/v1/wrapper/cdot
```

### Endpoint: Check IMEI

**Check device IMEI against C-DOT blocklist**

```
POST /wrapper/cdot/check-imei
```

#### Request Headers

```
Content-Type: application/json
X-API-Key: cdot_<your_api_key>
```

#### Request Body

```json
{
  "imei": "356284535498141",
  "deviceName": "Samsung Galaxy S25 Ultra",
  "reference": "OPTIONAL_INTERNAL_REF_ID"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| imei | string | Yes | Device IMEI (15-16 digits) |
| deviceName | string | No | Device name for logging |
| reference | string | No | Your internal reference ID |

#### Response - Success (200 OK)

```json
{
  "success": true,
  "data": {
    "imei": "356284535498141",
    "status": "CLEAN",
    "blocklisted": false,
    "checkTimestamp": "2026-10-14T08:30:45.123Z",
    "costPaise": 1900,
    "walletBalanceBefore": 100000,
    "walletBalanceAfter": 98100
  }
}
```

#### Response - Status Values

| Status | Meaning | Action |
|--------|---------|--------|
| CLEAN | Device not blocklisted | Safe to proceed |
| BLOCKLISTED | Device in CEIR database | Reject device |
| UNKNOWN | Service error/timeout | Retry later |

#### Response - Error (4xx/5xx)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_IMEI",
    "message": "IMEI must be 15 or 16 digits",
    "details": "Provided IMEI: 12345"
  }
}
```

---

## Integration Examples

### Example 1: Node.js / JavaScript

```javascript
const axios = require('axios');

const checkIMEI = async (imei, deviceName) => {
  try {
    const response = await axios.post(
      'https://business.grest.in/api/v1/wrapper/cdot/check-imei',
      {
        imei: imei,
        deviceName: deviceName,
        reference: `REF-${Date.now()}`
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.CDOT_API_KEY
        }
      }
    );

    if (response.data.success) {
      const { status, blocklisted } = response.data.data;
      
      if (blocklisted) {
        console.log(`❌ Device ${imei} is blocklisted`);
        return false;
      } else {
        console.log(`✓ Device ${imei} is clean (status: ${status})`);
        console.log(`Wallet remaining: ₹${response.data.data.walletBalanceAfter / 100}`);
        return true;
      }
    }
  } catch (error) {
    console.error('API Error:', error.response?.data?.error || error.message);
    return null; // Retry later
  }
};

// Usage
await checkIMEI('356284535498141', 'Samsung Galaxy S25 Ultra');
```

### Example 2: Python

```python
import requests
import os

def check_imei(imei, device_name):
    api_key = os.getenv('CDOT_API_KEY')
    
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': api_key
    }
    
    payload = {
        'imei': imei,
        'deviceName': device_name,
        'reference': f'REF-{int(time.time())}'
    }
    
    response = requests.post(
        'https://business.grest.in/api/v1/wrapper/cdot/check-imei',
        json=payload,
        headers=headers
    )
    
    if response.status_code == 200:
        data = response.json()['data']
        
        if data['blocklisted']:
            print(f"❌ IMEI {imei} is blocklisted")
            return False
        else:
            print(f"✓ IMEI {imei} is clean")
            balance = data['walletBalanceAfter'] / 100
            print(f"Wallet: ₹{balance}")
            return True
    else:
        print(f"Error: {response.status_code}")
        print(response.json())
        return None

# Usage
check_imei('356284535498141', 'Samsung Galaxy S25 Ultra')
```

### Example 3: cURL

```bash
curl -X POST https://business.grest.in/api/v1/wrapper/cdot/check-imei \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cdot_your_api_key_here" \
  -d '{
    "imei": "356284535498141",
    "deviceName": "Samsung Galaxy S25 Ultra",
    "reference": "REF-1234567890"
  }'
```

### Example 4: Bulk Verification (Batch Processing)

```javascript
const checkMultipleIMEIs = async (imeiList) => {
  const results = [];
  
  for (const { imei, deviceName } of imeiList) {
    try {
      const response = await axios.post(
        'https://business.grest.in/api/v1/wrapper/cdot/check-imei',
        { imei, deviceName },
        {
          headers: {
            'X-API-Key': process.env.CDOT_API_KEY
          }
        }
      );
      
      results.push({
        imei,
        status: response.data.data.status,
        blocklisted: response.data.data.blocklisted,
        cost: response.data.data.costPaise / 100
      });
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.push({
        imei,
        error: error.message
      });
    }
  }
  
  return results;
};

// Usage
const imeis = [
  { imei: '356284535498141', deviceName: 'iPhone 13' },
  { imei: '352986114035656', deviceName: 'iPhone 11' }
];

const results = await checkMultipleIMEIs(imeis);
console.log(results);
```

---

## Error Handling

### HTTP Status Codes

| Code | Reason | Action |
|------|--------|--------|
| 200 | Success | Process result |
| 400 | Bad Request | Fix request format |
| 401 | Unauthorized | Check API key |
| 403 | Forbidden | Insufficient wallet balance |
| 404 | Not Found | Check endpoint URL |
| 429 | Rate Limited | Wait and retry |
| 500 | Server Error | Retry after delay |
| 503 | Service Unavailable | Retry later |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional context if available"
  }
}
```

### Common Errors

#### Invalid IMEI Format

```json
{
  "error": {
    "code": "INVALID_IMEI",
    "message": "IMEI must be 15 or 16 digits"
  }
}
```

**Solution**: Validate IMEI format before sending. IMEI should match: `^[0-9]{15,16}$`

#### Insufficient Wallet Balance

```json
{
  "error": {
    "code": "INSUFFICIENT_WALLET_BALANCE",
    "message": "Wallet balance is below ₹19"
  }
}
```

**Solution**: Top up wallet balance immediately

#### API Key Invalid

```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "API key not found or revoked"
  }
}
```

**Solution**: Check API key in X-API-Key header

#### Rate Limit Exceeded

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests (max 100/min)"
  }
}
```

**Solution**: Implement exponential backoff retry logic

### Retry Strategy

```javascript
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Usage
const result = await retryWithBackoff(() => checkIMEI('356284535498141'));
```

---

## Vendor Dashboard

Access your vendor dashboard to:

1. **View Wallet**
   - Current balance
   - Top-up history
   - Transaction log

2. **API Management**
   - View API key
   - Regenerate key
   - View API call logs

3. **Analytics**
   - Total checks performed
   - Success/failure rate
   - Top 10 devices checked
   - Daily usage trend

4. **Support**
   - Download reports
   - Export transaction history
   - Contact support

**Dashboard URL**: https://business.grest.in/vendor/cdot/dashboard

---

## Support & Contact

### Get Help

- **Email**: support@grest.in
- **Phone**: +91 XXXXX-XXXXX
- **Hours**: Monday-Friday, 9 AM - 6 PM IST

### Vendor Portal

- **Login**: https://business.grest.in/vendor/cdot/login
- **Dashboard**: https://business.grest.in/vendor/cdot/dashboard

### Escalation

For urgent issues:
1. Contact support immediately
2. Provide API key (without exposing full key)
3. Include request/response examples
4. Describe expected vs actual behavior

### Best Practices

- ✓ Always use HTTPS
- ✓ Store API keys in environment variables
- ✓ Implement retry logic with exponential backoff
- ✓ Cache results when appropriate
- ✓ Monitor wallet balance proactively
- ✓ Use meaningful reference IDs for tracking
- ✓ Log all API interactions for debugging
- ✓ Validate IMEI format before sending requests

---

## API Changes & Deprecations

### Version 1.0 (Current)

- Initial release
- Single endpoint: POST /wrapper/cdot/check-imei
- Wallet-based billing model

### Planned Features

- Batch verification endpoint (v1.1)
- Webhook notifications (v1.1)
- Advanced filtering options (v1.2)
- Custom reporting (v1.2)

Subscribe to updates: support@grest.in

---

## Legal & Compliance

### Data Privacy

- IMEI data is processed only for verification
- No storage beyond transaction logs
- Compliant with GDPR, DPDP Act 2023
- Regular security audits

### Service Level Agreement (SLA)

- **Uptime**: 99.5% per month
- **Response Time**: < 2 seconds per request
- **Support**: 24/5 ticket support

---

**Last Updated**: October 14, 2026  
**Version**: 1.0  
**Document Status**: Ready for Third-Party Distribution
