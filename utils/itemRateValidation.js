/**
 * Aligns with client `src/utils/itemRateValidation.js`.
 * When min sale rate > 0: purchase <= min <= sale (and sale >= purchase when purchase > 0).
 * Min 0 or null skips the min band.
 */
function validateItemRatesConsistency({ saleRate, purchaseRate, minSaleRate }) {
  const sale = parseFloat(saleRate);
  const purchase =
    purchaseRate !== undefined && purchaseRate !== null && purchaseRate !== ''
      ? parseFloat(purchaseRate)
      : NaN;
  const hasPurchase = Number.isFinite(purchase);
  const minRaw = minSaleRate;
  const min =
    minRaw !== undefined && minRaw !== null && minRaw !== '' && !Number.isNaN(parseFloat(minRaw))
      ? parseFloat(minRaw)
      : null;

  if (!Number.isFinite(sale) || sale <= 0) {
    return { ok: false, error: 'Sale rate must be greater than zero' };
  }
  if (hasPurchase && purchase > 0 && sale < purchase) {
    return { ok: false, error: 'Sale rate must be greater than or equal to purchase rate' };
  }
  if (min != null && !Number.isNaN(min)) {
    if (min < 0) {
      return { ok: false, error: 'Minimum sale rate cannot be negative' };
    }
    if (min > 0) {
      if (sale < min) {
        return { ok: false, error: 'Sale rate must be greater than or equal to minimum sale rate' };
      }
      if (hasPurchase && purchase > 0 && min < purchase) {
        return { ok: false, error: 'Minimum sale rate must be greater than or equal to purchase rate' };
      }
    }
  }
  return { ok: true };
}

module.exports = { validateItemRatesConsistency };
