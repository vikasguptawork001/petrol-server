// Convert number to Indian Rupees in words
const numberToWords = (num) => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  const convertHundreds = (n) => {
    let result = '';
    let remaining = n;
    if (remaining >= 100) {
      result += ones[Math.floor(remaining / 100)] + ' Hundred ';
      remaining = remaining % 100;
    }
    if (remaining >= 20) {
      result += tens[Math.floor(remaining / 10)] + ' ';
      remaining = remaining % 10;
    }
    if (remaining > 0) {
      result += ones[remaining] + ' ';
    }
    return result.trim();
  };
  
  if (num === 0) return 'Zero Rupees Only';
  
  const parts = num.toString().split('.');
  let wholePart = parseInt(parts[0], 10);
  const decimalPart = parts[1] ? parseInt(parts[1].padEnd(2, '0').substring(0, 2), 10) : 0;
  
  let result = '';
  
  // Convert whole part
  if (wholePart >= 10000000) {
    result += convertHundreds(Math.floor(wholePart / 10000000)) + ' Crore ';
    wholePart = wholePart % 10000000;
  }
  if (wholePart >= 100000) {
    result += convertHundreds(Math.floor(wholePart / 100000)) + ' Lakh ';
    wholePart = wholePart % 100000;
  }
  if (wholePart >= 1000) {
    result += convertHundreds(Math.floor(wholePart / 1000)) + ' Thousand ';
    wholePart = wholePart % 1000;
  }
  if (wholePart > 0) {
    result += convertHundreds(wholePart) + ' ';
  }
  
  result = result.trim();
  if (!result) result = 'Zero';
  
  result += ' Rupees';
  
  // Convert decimal part (paise)
  if (decimalPart > 0) {
    result += ' and ' + convertHundreds(decimalPart) + ' Paise';
  }
  
  return result + ' Only';
};

module.exports = { numberToWords };







