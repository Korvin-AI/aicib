# FreelancerPM -- Financial Projection

**Prepared by:** CFO Agent
**Date:** 2026-02-14
**Status:** Draft v1 -- Pending founder decision on pricing model (single tier vs. freemium)

---

## Executive Summary

At a $19/mo price point with a single paid tier, FreelancerPM can reach $10K MRR by Month 10 and break even by Month 9. Unit economics are healthy: LTV/CAC ratio of 4.2x with a 3.5-month payback period. The primary risk is customer acquisition cost -- if CAC exceeds $55, the payback period stretches beyond 5 months and the break-even timeline shifts to Month 12+.

## Revenue Projection (Year 1)

| Month | New Users | Churned | Total Users | MRR      | MoM Growth |
|-------|-----------|---------|-------------|----------|------------|
| 1     | 30        | 0       | 30          | $570     | --         |
| 2     | 40        | 2       | 68          | $1,292   | +127%      |
| 3     | 50        | 4       | 114         | $2,166   | +68%       |
| 4     | 55        | 6       | 163         | $3,097   | +43%       |
| 5     | 60        | 8       | 215         | $4,085   | +32%       |
| 6     | 65        | 11      | 269         | $5,111   | +25%       |
| 7     | 70        | 13      | 326         | $6,194   | +21%       |
| 8     | 80        | 16      | 390         | $7,410   | +20%       |
| 9     | 90        | 20      | 460         | $8,740   | +18%       |
| 10    | 100       | 23      | 537         | $10,203  | +17%       |
| 11    | 110       | 27      | 620         | $11,780  | +15%       |
| 12    | 120       | 31      | 709         | $13,471  | +14%       |

**Year 1 total revenue: ~$74,100**

### Napkin Math: How We Got These Numbers

Monthly churn rate is set at 5% (industry average for SMB SaaS is 3-7%). New user growth starts at 30/month (achievable via Product Hunt launch + organic) and increases by roughly 10 users/month as marketing channels mature. This is conservative -- a successful Product Hunt launch alone could deliver 100+ signups in Month 1.

## Unit Economics

| Metric                 | Value   | Calculation                                              |
|------------------------|---------|----------------------------------------------------------|
| **Monthly price**      | $19     | Single tier, no free plan                                |
| **Monthly churn rate** | 5.0%    | ~1 in 20 users cancels each month                       |
| **Average lifespan**   | 20 mo   | 1 / 0.05 = 20 months                                    |
| **LTV (lifetime value)** | $380 | $19 x 20 months                                          |
| **CAC (cost to acquire)** | $42  | Blended across organic ($0), paid ($80), content ($25)   |
| **LTV/CAC ratio**      | 4.2x    | $380 / $42 -- healthy (target is >3x)                   |
| **Payback period**     | 3.5 mo  | $42 / ($19 x 0.65 gross margin) = 3.4 months            |
| **Gross margin**       | 65%     | After Stripe fees (2.9%), infra, and email costs         |

### Napkin Math: Why 65% Gross Margin?

For every $19 we collect: Stripe takes $0.55 (2.9%), infrastructure costs ~$1.50/user/month (Railway + S3 + email), leaving ~$16.95. That is a 89% margin on direct costs, but when we allocate shared infrastructure (database, monitoring, CI/CD) across the user base, it comes down to roughly 65% at our early scale. This improves as we grow -- at 1,000 users, gross margin should exceed 80%.

## Break-Even Analysis

| Category          | Monthly Cost | Notes                              |
|-------------------|--------------|------------------------------------|
| Infrastructure    | $350         | Railway, Supabase, Resend, S3      |
| Marketing spend   | $2,500       | Paid ads + content freelancers     |
| Tools & SaaS      | $200         | Analytics, monitoring, domain      |
| AI operating cost | $150         | AICIB runs for ongoing strategy    |
| **Total monthly** | **$3,200**   |                                    |

**Break-even point:** $3,200 / $19 = **169 paying users** (projected to hit in Month 4-5).

Note: This does not include founder salary. If the founder draws $5,000/mo, break-even shifts to 432 users (Month 8-9). The projection table above uses the $5K founder salary assumption for the Month 9 break-even estimate in the executive summary.

## Cost Structure (Year 1 Total)

| Category             | Year 1 Cost | % of Revenue |
|----------------------|-------------|--------------|
| Infrastructure       | $4,200      | 5.7%         |
| Marketing            | $30,000     | 40.5%        |
| Tools & subscriptions| $2,400      | 3.2%         |
| AI operating costs   | $1,800      | 2.4%         |
| Founder salary       | $60,000     | 81.0%        |
| **Total expenses**   | **$98,400** |              |
| **Net income (Y1)**  | **-$24,300**| Year 1 loss  |

Year 1 ends at a loss, which is expected. The business becomes cash-flow positive on a monthly basis around Month 9. The cumulative loss narrows through the back half of the year and should flip positive in Month 4-5 of Year 2.

## Sensitivity Analysis

### Scenario A: CAC Is 30% Higher ($55 Instead of $42)

- LTV/CAC drops from 4.2x to 3.2x (still above the 3x safety threshold)
- Payback period extends from 3.5 to 4.5 months
- Break-even timeline shifts ~2 months later
- **Verdict:** Uncomfortable but survivable. We should monitor CAC weekly and cut underperforming channels fast.

### Scenario B: Churn Doubles (10% Monthly Instead of 5%)

- Average lifespan drops from 20 months to 10 months
- LTV drops from $380 to $190
- LTV/CAC ratio drops to 2.1x -- **below the 3x threshold**
- **Verdict:** This would be a serious problem. If churn exceeds 7%, we need to pause acquisition spending and focus entirely on retention (onboarding improvements, feature gaps, support).

### Scenario C: Both A and B Happen Together

- LTV/CAC drops to 1.6x
- **Verdict:** The business model does not work at these numbers. Pivot pricing (raise to $29/mo) or fundamentally rethink the product-market fit.

## Bottom Line

**At $19/mo with reasonable acquisition costs and industry-average churn, FreelancerPM is a viable bootstrapped SaaS that reaches profitability within 9 months on roughly $25K of total investment.**

## Assumptions

1. No free tier -- all users are paying $19/mo from day one
2. No annual pricing discount modeled (annual plans would improve cash flow but reduce effective MRR per user)
3. Stripe is the only payment processor (2.9% + $0.30 per transaction)
4. Marketing spend ramps linearly; no viral coefficient modeled
5. Single founder, no employees in Year 1
6. Infrastructure costs scale roughly linearly with user count at this stage
7. No fundraising -- entirely bootstrapped from founder savings
8. Churn rate is flat at 5%/month across all cohorts (in reality, later cohorts typically retain better as the product matures)

## Caveats

- These projections assume a successful product launch with moderate traction. A failed Product Hunt launch or poor initial reviews could reduce Month 1-3 signups by 50%+.
- The 5% churn rate is an assumption, not a measurement. Real churn data won't exist until Month 3 at the earliest. This is the single most important number to watch.
- CAC is a blended estimate. Organic channels (Product Hunt, Reddit, SEO) have near-zero CAC but don't scale linearly. As organic plateaus, blended CAC will rise.
- No competitor response is modeled. If Bonsai drops their price or Notion adds invoicing, our positioning may need to shift.

---

**Next step:** Founder to confirm pricing model so we can produce a v2 projection. If freemium is chosen, we need to model conversion rates (typical: 2-5% of free users convert to paid), which significantly changes the acquisition math.
