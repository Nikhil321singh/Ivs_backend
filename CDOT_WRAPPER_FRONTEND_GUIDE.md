# C-DOT Wrapper API - Frontend Implementation Guide

## Overview
This system allows vendors to integrate C-DOT (blocked/stolen device) verification into their applications via a **pay-per-use** API with a **₹19 cost per IMEI check**.

---

## 🎯 Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌────────────────┐
│  Vendor Admin   │         │  Vendor App      │         │   Your Admin   │
│  Dashboard      │         │  (Uses API Key)  │         │   Dashboard    │
└────────┬────────┘         └──────────┬───────┘         └────────┬───────┘
         │                            │                           │
         │ Login/Register             │ POST with API Key         │ Manage vendors
         │ View stats                 │ /wrapper/cdot/check-imei  │ View analytics
         │ Download data              │                           │ Adjust wallets
         │ Regenerate API key         │                           │ Suspend vendors
         │                            │                           │
         └────────────┬───────────────┴───────────────────────────┘
                      │
                      ↓
            ┌──────────────────┐
            │   Backend API    │
            │  - Auth          │
            │  - Wrapper       │
            │  - Admin         │
            └──────────────────┘
```

---

## 📱 FRONTEND 1: VENDOR DASHBOARD

### Purpose
Vendors log in to manage their API usage, view costs, and download transaction data.

### URL
```
https://partnersadmin.grest.in/cdot/vendor
or
https://yourapp.com/vendor/dashboard
```

### Pages Required

#### 1. **Login Page** (`/vendor/cdot/login`)
```
Fields:
  - Email (text input)
  - Password (password input)
  - [Login] button

On Success:
  - Store JWT token (localStorage or secure cookie)
  - Redirect to Dashboard
  
On Failure:
  - Show error message from API
  - "Invalid email or password"
```

**Request:**
```javascript
POST /api/v1/vendor/cdot/auth/login
{
  "email": "vendor@abc.com",
  "password": "SecurePass123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Logged in successfully.",
  "data": {
    "vendor": {
      "id": "6ab539...",
      "email": "vendor@abc.com",
      "companyName": "ABC Telecom",
      "walletBalance": 50000
    },
    "apiKey": "cdot_7f9h2k1m...",
    "token": "eyJhbGc..."
  }
}
```

---

#### 2. **Dashboard Page** (`/vendor/cdot/dashboard`)
**Shows at-a-glance stats**

```
┌─────────────────────────────────────────────────────┐
│  Welcome, ABC Telecom                  [Logout]     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Wallet       │  │ API Calls    │  │ Spent     │ │
│  │ ₹500         │  │ 156          │  │ ₹2,964    │ │
│  │ 26 checks    │  │              │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  [Top Up Wallet]  [View API Calls]  [Download CSV] │
│  [Regenerate Key] [Change Password]                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Request:**
```javascript
GET /api/v1/vendor/cdot/dashboard
Headers: {
  Authorization: "Bearer <token>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "vendor": {
      "id": "...",
      "companyName": "ABC Telecom",
      "email": "vendor@abc.com"
    },
    "wallet": {
      "balance": 50000,
      "checksRemaining": 26
    },
    "stats": {
      "totalCalls": 156,
      "totalSpent": 296400
    }
  }
}
```

---

#### 3. **API Calls History** (`/vendor/cdot/calls`)
**Table showing all IMEI checks**

```
┌────────────────────────────────────────────────────┐
│ Recent API Calls                    [Export CSV]   │
├────────────────────────────────────────────────────┤
│ IMEI            │ Status   │ Cost  │ Date         │
├─────────────────┼──────────┼───────┼──────────────┤
│ 353170101039885 │ CLEAN    │ ₹19   │ Oct 10, 2PM  │
│ 357016087654321 │ BLOCKED  │ ₹19   │ Oct 10, 1PM  │
│ 491234567890123 │ CLEAN    │ ₹19   │ Oct 10, 12PM │
│ ...             │ ...      │ ...   │ ...          │
└────────────────────────────────────────────────────┘

[< Previous] Page 1 of 8 [Next >]
```

**Request:**
```javascript
GET /api/v1/vendor/cdot/api-calls?page=1&limit=20
Headers: {
  Authorization: "Bearer <token>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "calls": [
      {
        "id": "...",
        "imei": "353170101039885",
        "status": "CLEAN",
        "cost": 1900,
        "date": "2026-10-10T14:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 156,
      "pages": 8
    }
  }
}
```

---

#### 4. **Transactions History** (`/vendor/cdot/transactions`)
**Wallet debit/credit log**

```
┌────────────────────────────────────────────────────┐
│ Wallet Transactions                [Export CSV]   │
├────────────────────────────────────────────────────┤
│ Type   │ Amount │ Reason      │ Balance │ Date     │
├────────┼────────┼─────────────┼─────────┼──────────┤
│ DEBIT  │ -₹19   │ CDOT_CHECK  │ ₹500    │ Oct 10   │
│ DEBIT  │ -₹19   │ CDOT_CHECK  │ ₹519    │ Oct 10   │
│ CREDIT │ +₹500  │ TOP_UP      │ ₹538    │ Oct 9    │
└────────────────────────────────────────────────────┘
```

**Request:**
```javascript
GET /api/v1/vendor/cdot/transactions?page=1&limit=20
Headers: {
  Authorization: "Bearer <token>"
}
```

---

#### 5. **API Key Management** (`/vendor/cdot/api-key`)
**Display and regenerate API key**

```
┌───────────────────────────────────────────────────┐
│ Your API Key                                      │
├───────────────────────────────────────────────────┤
│                                                   │
│ Key: cdot_7f9h2k1m5n8p3q6r9s2t5u8v               │
│ [Copy to Clipboard] [Regenerate]                 │
│                                                   │
│ Created: Oct 5, 2026                             │
│ Last Used: 2 minutes ago                         │
│                                                   │
│ ⚠️ Keep this key secret!                         │
│ Never share it or commit it to public repos.     │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Get Key:**
```javascript
GET /api/v1/vendor/cdot/api-key
Headers: {
  Authorization: "Bearer <token>"
}
```

**Regenerate Key:**
```javascript
POST /api/v1/vendor/cdot/api-key/regenerate
Headers: {
  Authorization: "Bearer <token>"
}

Response: { key: "cdot_newkey..." }
```

---

#### 6. **Change Password** (`/vendor/cdot/settings`)

```
┌────────────────────────────────────┐
│ Change Password                    │
├────────────────────────────────────┤
│ Current Password: [_____________]  │
│ New Password:     [_____________]  │
│ Confirm:          [_____________]  │
│                                    │
│ [Change] [Cancel]                 │
└────────────────────────────────────┘
```

**Request:**
```javascript
POST /api/v1/vendor/cdot/auth/change-password
Headers: {
  Authorization: "Bearer <token>"
}
Body: {
  "currentPassword": "OldPass123",
  "newPassword": "NewPass456"
}
```

---

## 🛠️ FRONTEND 2: ADMIN DASHBOARD

### Purpose
Admins manage all vendors, view analytics, adjust wallets, and export data.

### URL
```
https://partnersadmin.grest.in/admin/cdot
```

### Pages Required

#### 1. **Vendor List** (`/admin/cdot/vendors`)
**All vendors with status**

```
┌──────────────────────────────────────────────────────────┐
│ C-DOT Vendors                    [+ New Vendor] [Export] │
├──────────────────────────────────────────────────────────┤
│ Search: [_________________]  Status: [Active ▼]         │
├──────────────────────────────────────────────────────────┤
│ Company       │ Email           │ Calls │ Spent  │ Status │
├───────────────┼─────────────────┼───────┼────────┼────────┤
│ ABC Telecom   │ vendor@abc.com  │  156 │ ₹2,964 │ ✓ OK   │
│ XYZ Corp      │ vendor@xyz.com  │  89  │ ₹1,691 │ ✓ OK   │
│ PQR Services  │ vendor@pqr.com  │  0   │ -      │ ✗ Susp │
│ [View] [Edit] │ ...                                      │
└──────────────────────────────────────────────────────────┘

[< Previous] Page 1 of 3 [Next >]
```

**Request:**
```javascript
GET /admin/cdot/vendors?page=1&limit=20&search=&isActive=true
Headers: {
  Authorization: "Bearer <admin-token>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "vendors": [
      {
        "id": "6ab539...",
        "email": "vendor@abc.com",
        "companyName": "ABC Telecom",
        "walletBalance": 50000,
        "totalCalls": 156,
        "totalSpent": 296400,
        "isActive": true,
        "lastActivity": "2026-10-10T14:30:00Z",
        "createdAt": "2026-10-05T12:00:00Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45, "pages": 3 }
  }
}
```

---

#### 2. **Create New Vendor** (`/admin/cdot/vendors/create`)

```
┌──────────────────────────────────┐
│ Create New C-DOT Vendor          │
├──────────────────────────────────┤
│ Email:           [____________] │
│ Company Name:    [____________] │
│ Initial Balance: [0         ] ₹  │
│                                  │
│ [Create] [Cancel]                │
│                                  │
│ ℹ️ Vendor will receive:           │
│   - Temp password (must change)  │
│   - API key (for integration)    │
└──────────────────────────────────┘
```

**Request:**
```javascript
POST /admin/cdot/vendors
Body: {
  "email": "newvendor@company.com",
  "companyName": "New Company",
  "initialWalletBalance": 100000
}

Response: {
  "apiKey": "cdot_...",
  "tempPassword": "TempAbc123",
  "message": "Share with vendor..."
}
```

---

#### 3. **Vendor Details** (`/admin/cdot/vendors/:vendorId`)

```
┌────────────────────────────────────────────────────┐
│ ABC Telecom - Vendor Details                       │
├────────────────────────────────────────────────────┤
│ Email: vendor@abc.com                              │
│ Status: [Active ▼]                                 │
│                                                    │
│ WALLET                      STATS                  │
│ Balance: ₹500               Calls: 156             │
│ Checks: 26                  Spent: ₹2,964          │
│ Last Activity: 2 mins ago                          │
│                                                    │
│ [Top Up] [Adjust] [Suspend] [Export Data]         │
│                                                    │
│ API KEY                                            │
│ cdot_7f9h2k1m5n8p3q6r9s2t5u8v                      │
│ Created: Oct 5, 2026                               │
│ Last Used: 2 mins ago                              │
│                                                    │
│ RECENT API CALLS                                   │
│ ┌──────────────┬──────────┬──────┬─────────────┐  │
│ │ IMEI         │ Status   │ Cost │ Date        │  │
│ ├──────────────┼──────────┼──────┼─────────────┤  │
│ │ 3531701...   │ CLEAN    │ ₹19  │ Oct 10, 2PM │  │
│ └──────────────┴──────────┴──────┴─────────────┘  │
│                                                    │
│ RECENT TRANSACTIONS                                │
│ ┌──────┬────────┬────────────┬─────────────────┐  │
│ │ Type │ Amount │ Reason     │ Date            │  │
│ ├──────┼────────┼────────────┼─────────────────┤  │
│ │DEBIT │ -₹19   │ CDOT_CHECK │ Oct 10, 2PM     │  │
│ └──────┴────────┴────────────┴─────────────────┘  │
└────────────────────────────────────────────────────┘
```

**Request:**
```javascript
GET /admin/cdot/vendors/{vendorId}
```

---

#### 4. **Adjust Wallet** (Modal/Dialog)

```
┌──────────────────────────────────────┐
│ Adjust Wallet - ABC Telecom          │
├──────────────────────────────────────┤
│ Current Balance: ₹500                │
│                                      │
│ Amount: [_________________]          │
│ (positive to credit, negative to     │
│  debit)                              │
│                                      │
│ Reason: [_________________]          │
│                                      │
│ [Apply] [Cancel]                     │
└──────────────────────────────────────┘
```

**Request:**
```javascript
PATCH /admin/cdot/vendors/{vendorId}/wallet
Body: {
  "amount": 50000,
  "reason": "Promotional credit"
}
```

---

#### 5. **Analytics Dashboard** (`/admin/cdot/analytics`)

```
┌────────────────────────────────────────────────────┐
│ C-DOT Analytics                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Vendors  │  │ Calls    │  │ Revenue  │         │
│  │ 45       │  │ 12,500   │  │ ₹2,37,500│         │
│  │ 38 Active│  │          │  │          │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                    │
│  TOP VENDORS                                      │
│  ┌──────────────────────────────────────────┐    │
│  │ 1. ABC Telecom      | 2456 calls | ₹46k  │    │
│  │ 2. XYZ Corp         | 1203 calls | ₹22k  │    │
│  │ 3. PQR Services     | 892 calls  | ₹16k  │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  REVENUE TREND (Last 30 days)                     │
│  [Line Chart]                                     │
│   Y: Revenue (₹)                                  │
│   X: Date (Oct 1 → Nov 9)                         │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Request:**
```javascript
GET /admin/cdot/analytics
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalVendors": 45,
      "activeVendors": 38,
      "inactiveVendors": 7,
      "totalApiCalls": 12500,
      "totalRevenue": 237500000,
      "avgCallsPerVendor": 278
    },
    "topVendors": [
      { "companyName": "ABC Telecom", "totalCalls": 2456, "totalSpent": 4664000 }
    ],
    "dailyRevenue": [
      { "date": "2026-10-10", "calls": 245, "revenue": 465500 }
    ]
  }
}
```

---

#### 6. **Suspend/Unsuspend Vendor**

```
Action Buttons on Vendor Details:

[Suspend]  → Modal: "Disable this vendor?"
            "All API keys will be deactivated."
            [Confirm] [Cancel]

[Unsuspend] → Modal: "Reactivate this vendor?"
             "API key will be restored."
             [Confirm] [Cancel]
```

**Suspend Request:**
```javascript
POST /admin/cdot/vendors/{vendorId}/suspend
```

**Unsuspend Request:**
```javascript
POST /admin/cdot/vendors/{vendorId}/unsuspend
```

---

#### 7. **Export Vendor Data**

```
[Export Data] button → Downloads CSV/JSON

CSV Format:
─────────────────────────────
IMEI,Status,Cost (₹),Date
353170101039885,CLEAN,19.00,2026-10-10T14:30:00Z
357016087654321,BLOCKED,19.00,2026-10-10T13:45:00Z
─────────────────────────────
```

**Request:**
```javascript
GET /admin/cdot/vendors/{vendorId}/export?format=csv
```

---

## 🔌 VENDOR INTEGRATION (How Vendors Use the API)

### In Vendor's Application

Vendors integrate the C-DOT check into their own apps:

```javascript
// Vendor's code (JavaScript/Python/Node/Java/etc)

const apiKey = "cdot_7f9h2k1m5n8p3q6r9s2t5u8v";
const imei = "353170101039885";

fetch('https://api.grest.in/api/v1/wrapper/cdot/check-imei', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  },
  body: JSON.stringify({ imei })
})
.then(res => res.json())
.then(data => {
  if (!data.success) {
    console.error('Error:', data.error);
    return;
  }

  console.log('IMEI Status:', data.data.imeiStatus); // CLEAN / BLOCKED / STOLEN
  console.log('Cost:', data.data.costDeducted / 100, '₹');
  console.log('Balance:', data.data.walletBalance / 100, '₹');
  console.log('Checks Left:', data.data.checksRemaining);
})
.catch(err => console.error('API Error:', err));
```

### Response Examples

**Success:**
```json
{
  "success": true,
  "data": {
    "imeiStatus": "CLEAN",
    "deviceStatus": "CLEAN",
    "blockingReason": null,
    "costDeducted": 1900,
    "walletBalance": 48100,
    "checksRemaining": 25,
    "details": { "imei": "353170101039885", "checkedAt": "2026-10-10T14:30:00Z" }
  }
}
```

**Insufficient Balance:**
```json
{
  "success": false,
  "error": "Insufficient wallet balance. Need ₹19, have ₹5.",
  "data": { "checksRemaining": 0, "balance": 500 }
}
```

---

## 🔐 Security Best Practices

### For Vendors
```
✅ DO:
  - Store API key in environment variables
  - Rotate key regularly (regenerate annually)
  - Use HTTPS for all requests
  - Never log the API key

❌ DON'T:
  - Commit API key to Git
  - Share key in Slack/Email
  - Use same key across multiple apps
  - Expose key in mobile app (it's for backend only)
```

### For Admin Panel
```
✅ DO:
  - Use strong JWT tokens (1-hour expiry)
  - Audit all wallet adjustments
  - Log admin actions
  - Use HTTPS only

❌ DON'T:
  - Allow unauthenticated requests
  - Store admin password in logs
  - Share admin credentials
```

---

## 📊 UI/UX Recommendations

### Vendor Dashboard
- **Color scheme:** Professional (blue/gray)
- **Cards:** Show key metrics prominently
- **Tables:** Pagination for large datasets
- **CTA buttons:** "Top Up Wallet", "View API Calls", "Download CSV"
- **Copy button:** One-click copy API key to clipboard
- **Toast notifications:** Show success/error messages

### Admin Dashboard
- **Dashboard tiles:** Show KPIs (total vendors, revenue, calls)
- **Charts:** Line graph for daily revenue trend
- **Search/Filter:** By email, company name, status
- **Bulk actions:** Suspend multiple vendors at once
- **Audit trail:** Log who adjusted what wallet and when
- **Bulk export:** Export all vendors' data

---

## 🚀 Implementation Checklist

### Vendor Frontend
- [ ] Login page (email/password)
- [ ] Dashboard (wallet, calls, spent)
- [ ] API calls history table with pagination
- [ ] Transactions history table with pagination
- [ ] API key display + copy button
- [ ] API key regenerate with confirmation
- [ ] Change password modal
- [ ] CSV export functionality
- [ ] Logout functionality
- [ ] Session timeout (1 hour)
- [ ] Error handling & user feedback
- [ ] Mobile responsive design

### Admin Frontend
- [ ] Login (already exists, reuse existing admin login)
- [ ] Vendor list with search/filter
- [ ] Create new vendor modal
- [ ] Vendor detail view
- [ ] Wallet adjustment modal
- [ ] Suspend/unsuspend actions
- [ ] Analytics dashboard with charts
- [ ] Export vendor data (CSV/JSON)
- [ ] Daily revenue trend chart
- [ ] Top vendors list
- [ ] Error handling & validation
- [ ] Mobile responsive design

---

## 📞 API Base URL

```
Production: https://api.grest.in/api/v1
Staging:    https://staging-api.grest.in/api/v1
Local:      http://localhost:5000/api/v1
```

---

## 🎓 Example Integration

### Vendor's Backend (Node.js)

```javascript
const express = require('express');
const axios = require('axios');

const app = express();

// Endpoint in vendor's own app
app.post('/check-device', async (req, res) => {
  const { imei } = req.body;
  const apiKey = process.env.GREST_CDOT_API_KEY; // Stored in .env

  try {
    const response = await axios.post(
      'https://api.grest.in/api/v1/wrapper/cdot/check-imei',
      { imei },
      { headers: { 'X-API-Key': apiKey } }
    );

    if (!response.data.success) {
      return res.status(402).json({ error: response.data.error });
    }

    res.json({
      status: response.data.data.imeiStatus,
      checksLeft: response.data.data.checksRemaining
    });
  } catch (error) {
    res.status(500).json({ error: 'IMEI check failed' });
  }
});

app.listen(3000);
```

---

**Questions? Reach out to the backend team!** 🚀
