const PDFDocument = require('pdfkit');
const { numberToWords } = require('./numberToWords');
const fs = require('fs');
const path = require('path');


let companyConfig = null;
function getCompanyConfig() {
  if (!companyConfig) {
    try {
      const configPath = path.join(__dirname, '../config/company.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      companyConfig = JSON.parse(configData);
    } catch (error) {
      console.error('Error loading company config:', error);
      // Fallback to default values
      companyConfig = {
        company_name: 'STEEPRAY INFORMATION SERVICES PRIVATE LIMITED',
        address: 'Company Address',
        contact: 'Insert Contact',
        email: 'Insert Email',
        business_description: 'Insert Business Description',
        gstin: 'Insert GSTIN',
        bank: {
          name: 'Insert Bank Name',
          account_number: 'Insert Account Number',
          ifsc_code: 'Insert IFSC Code'
        },
        terms_and_conditions: [
          'E.& O.E.',
          '1. Goods once sold will not be taken back.',
          '2. Interest @ 18% p.a. will be charged if payment is not made within 45 days.',
          '3. Subject to \'Patna\' Jurisdiction only.'
        ],
        signature: {
          company_name_line1: 'For STEEPRAY INFORMATION',
          company_name_line2: 'SERVICES PRIVATE LIMITED',
          authorized_signatory: 'Authorised Signatory'
        }
      };
    }
  }
  return companyConfig;
}

const formatCurrency = (amount) => {
  return parseFloat(amount).toFixed(2);
};

// Helper function to add page numbers to PDF footer
function addPageNumbers(doc, margin, pageWidth, pageHeight) {
  // Return function to add final page numbers (when total is known)
  return {
    addFinalPageNumbers: () => {
      try {
        // Get final page count from buffered pages
        let finalTotal = 1;
        try {
          const range = doc.bufferedPageRange();
          if (range && range.count && range.count > 0) {
            finalTotal = range.count;
          } else {
            // If no range or count is 0, it's a single page
            return;
          }
        } catch (e) {
          console.warn('Could not get page range:', e.message);
          return;
        }
        
        // Sanity check: if page count seems wrong (too many for a normal document), skip numbering completely
        // This prevents the 10-page issue where switchToPage might be creating pages
        if (finalTotal > 5) {
          console.warn(`[Page Numbers] Suspicious page count (${finalTotal}), skipping to prevent issues`);
          return;
        }
        
        // Add page numbers to all pages (including single page)
        if (finalTotal > 0 && finalTotal <= 5) {
          try {
            const range = doc.bufferedPageRange();
            if (!range || !range.count) {
              console.warn('[Page Numbers] Invalid page range, skipping');
              return;
            }
            
            const startPage = range.start;
            const actualPageCount = range.count;
            
            // Double-check: if actual count doesn't match, don't proceed
            if (actualPageCount !== finalTotal || actualPageCount > 5) {
              console.warn(`[Page Numbers] Page count mismatch (expected ${finalTotal}, got ${actualPageCount}), skipping`);
              return;
            }
            
            // Add page numbers to all pages - limit to actual count
            for (let i = 0; i < actualPageCount && i < 5; i++) {
              try {
                const pageIndex = startPage + i;
                
                // Only switch if page exists
                if (pageIndex >= startPage && pageIndex < startPage + actualPageCount) {
                  doc.switchToPage(pageIndex);
                  
                  // Save state before modifying
                  const savedY = doc.y;
                  const savedX = doc.x;
                  const savedBottomMargin = doc.page.margins.bottom;
                  
                  // Write page number in footer area
                  doc.page.margins.bottom = 0;
                  doc.fontSize(8).font('Helvetica').fillColor('#666');
                  
                  // Use absolute positioning to avoid triggering page breaks
                  const footerY = pageHeight - margin + 5;
                  // Always show "Page X of Y" format for all pages
                  const pageText = `Page ${i + 1} of ${actualPageCount}`;
                  doc.text(
                    pageText,
                    margin,
                    footerY,
                    { 
                      width: pageWidth - (margin * 2), 
                      align: 'center', 
                      lineBreak: false,
                      continued: false
                    }
                  );
                  
                  // Restore state
                  doc.page.margins.bottom = savedBottomMargin;
                  doc.x = savedX;
                  doc.y = savedY;
                  doc.fillColor('#000');
                }
              } catch (pageError) {
                console.warn(`Error adding page number to page ${i + 1}:`, pageError.message);
                // Stop if we hit an error to prevent creating more pages
                break;
              }
            }
          } catch (rangeError) {
            console.warn('Error getting page range for numbering:', rangeError.message);
          }
        }
      } catch (error) {
        console.error('Error adding page numbers:', error.message);
      }
    }
  };
}

const generateBillPDF = (transaction, items, res) => {
  let doc = null;
  let isStreamEnded = false;
  
  try {
    doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    const rightEdge = margin + contentWidth;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=bill_${transaction.bill_number}.pdf`);

    doc.on('error', (error) => {
      console.error('PDF document error:', error);
      if (!isStreamEnded && !res.headersSent) {
        isStreamEnded = true;
        doc.unpipe(res);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate PDF' });
        }
      }
    });

    res.on('error', (error) => {
      console.error('Response stream error:', error);
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
        doc.destroy();
      }
    });

    res.on('close', () => {
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
      }
    });

    doc.pipe(res);

    const company = getCompanyConfig();
    const withGst = transaction.with_gst === 1 || transaction.with_gst === true;

    // Set up page numbering
    const pageNumberHelper = addPageNumbers(doc, margin, pageWidth, pageHeight);

    let currentY = margin + 10;

    // ========== HEADER (Only for GST bills) ==========
    if (withGst) {
      doc.fontSize(16).font('Helvetica-Bold');
      doc.text(company.company_name, margin, currentY, {
        width: contentWidth,
        align: 'center'
      });
      
      doc.fontSize(9).font('Helvetica');
      doc.text(company.address, margin, doc.y + 5, { width: contentWidth, align: 'center' });
      doc.text(`Contact: ${company.contact} | Email: ${company.email}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
      doc.text(`Business Description: ${company.business_description}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
      
      doc.moveDown(0.3);
      currentY = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('GSTIN:', margin, currentY, { continued: false });
      doc.font('Helvetica');
      doc.text(company.gstin, margin + 50, currentY);
      
      // TAX INVOICE BOX
      currentY = doc.y + 10;
      doc.rect(margin, currentY, contentWidth, 30).stroke();
      doc.fontSize(14).font('Helvetica-Bold');
      doc.text('TAX INVOICE', margin, currentY + 10, { width: contentWidth, align: 'center' });
    } else {
      // For non-GST: Simple ESTIMATED BILL header only
      doc.rect(margin, currentY, contentWidth, 30).stroke();
      doc.fontSize(14).font('Helvetica-Bold');
      doc.text('ESTIMATED BILL', margin, currentY + 10, { width: contentWidth, align: 'center' });
    }
    
    // ========== BUYER & INVOICE DETAILS ==========
    currentY = doc.y + 25;
    const boxHeight = 85;
    const leftBoxWidth = 280;
    const rightBoxWidth = contentWidth - leftBoxWidth - 10;
    const rightBoxX = margin + leftBoxWidth + 10;
    
    // Left box - Buyer details
    doc.rect(margin, currentY, leftBoxWidth, boxHeight).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Buyer (Bill To):', margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    let textY = currentY + 18;
    doc.text(`Name: ${transaction.party_name || 'N/A'}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    doc.text(`Address: ${(transaction.address || 'N/A').substring(0, 50)}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    if (transaction.mobile_number) {
      doc.text(`Mobile No.: ${transaction.mobile_number}`, margin + 5, textY);
      textY += 12;
    }
    if (transaction.gst_number) {
      doc.text(`GSTIN / UIN: ${transaction.gst_number}`, margin + 5, textY);
    }
    
    // Right box - Invoice details
    doc.rect(rightBoxX, currentY, rightBoxWidth, boxHeight).stroke();
    
    doc.fontSize(8).font('Helvetica');
    textY = currentY + 5;
    const labelWidth = 90;
    const details = [
      ['Invoice No.:', transaction.bill_number],
      ['Dated:', new Date(transaction.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })],
      ['Place of Supply:', 'Bihar']
    ];
    if (transaction.attendant_name) {
      details.push(['Attendant:', transaction.attendant_name]);
    }
    if (transaction.nozzle_name) {
      details.push(['Nozzle:', transaction.nozzle_name]);
    }
    
    details.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(label, rightBoxX + 5, textY, { width: labelWidth, continued: false });
      doc.font('Helvetica').text(value, rightBoxX + labelWidth, textY);
      textY += 10;
    });
    
    // ========== ITEMS TABLE ==========
    currentY = currentY + boxHeight + 10;
    
    // Define precise column positions - conditional based on GST
    let cols;
    if (withGst) {
      cols = [
        { x: margin, width: 25, label: 'S.N.', align: 'center' },
        { x: margin + 25,  width: 130, label: 'Description', align: 'left' },
        { x: margin + 155, width: 42, label: 'HSN', align: 'center' },
        { x: margin + 197, width: 30, label: 'Qty', align: 'right' },
        { x: margin + 227, width: 30, label: 'Unit', align: 'center' },
        { x: margin + 257, width: 50, label: 'MRP', align: 'right' },
        { x: margin + 307, width: 40, label: 'Disc(₹)', align: 'right' },
        { x: margin + 342, width: 50, label: 'Price', align: 'right' },
        { x: margin + 392, width: 48, label: 'Tax Rate', align: 'center' },
        { x: margin + 440, width: 75, label: 'Amount', align: 'right' }
      ];
    } else {
      // Without GST: no HSN, no Tax Rate columns
      cols = [
        { x: margin, width: 25, label: 'S.N.', align: 'center' },
        { x: margin + 25,  width: 180, label: 'Description', align: 'left' }, // Wider description
        { x: margin + 205, width: 30, label: 'Qty', align: 'right' },
        { x: margin + 235, width: 30, label: 'Unit', align: 'center' },
        { x: margin + 265, width: 50, label: 'MRP', align: 'right' },
        { x: margin + 315, width: 40, label: 'Disc(₹)', align: 'right' },
        { x: margin + 350, width: 50, label: 'Price', align: 'right' },
        { x: margin + 400, width: 115, label: 'Amount', align: 'right' } // Wider amount column
      ];
    }
    
    // Table header background
    doc.rect(margin, currentY, contentWidth, 16).fillAndStroke('#e8e8e8', '#000');
    
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
    cols.forEach(col => {
      doc.text(col.label, col.x + 2, currentY + 4, { width: col.width - 4, align: col.align });
    });
    
    currentY += 16;
    doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
    
    // Table rows
    let serialNumber = 1;
    let totalTaxableValue = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalQty = 0;
    let totalDiscount = 0; // Track total discount amount
    
    doc.fontSize(7).font('Helvetica').fillColor('#000');
    
    items.forEach(item => {
      if (isStreamEnded) return;
      
      currentY += 4;
      
      const saleRate = parseFloat(item.sale_rate) || 0;
      const quantity = parseInt(item.quantity) || 0;
      totalQty += quantity;
      const itemTotal = saleRate * quantity;
      
      let productName = item.product_name || 'N/A';
      if (productName.length > 28) {
        productName = productName.substring(0, 26) + '..';
      }
      
      const taxRate = parseFloat(item.tax_rate) || 0;
      
      // Discount calculation
      let itemDiscount = 0;
      let discountPercent = 0;
      const itemDiscountType = item.discount_type || 'amount';
      if (itemDiscountType === 'percentage' && item.discount_percentage !== null) {
        discountPercent = item.discount_percentage;
        itemDiscount = (itemTotal * item.discount_percentage) / 100;
      } else {
        itemDiscount = parseFloat(item.discount || 0);
        discountPercent = itemTotal > 0 ? (itemDiscount / itemTotal) * 100 : 0;
      }
      
      itemDiscount = Math.min(itemDiscount, itemTotal);
      const itemTotalAfterDiscount = itemTotal - itemDiscount;
      const priceAfterDiscount = quantity > 0 ? itemTotalAfterDiscount / quantity : 0;
      
      // Track total discount
      totalDiscount += itemDiscount;
      
      let taxableValue = itemTotalAfterDiscount;
      let amount = itemTotalAfterDiscount;
      
      if (withGst && taxRate > 0) {
        taxableValue = itemTotalAfterDiscount / (1 + taxRate / 100);
        const tax = itemTotalAfterDiscount - taxableValue;
        totalTaxableValue += taxableValue;
        totalCgst += tax / 2;
        totalSgst += tax / 2;
      } else {
        totalTaxableValue += itemTotalAfterDiscount;
      }
      
      // Draw row data - conditional columns based on GST
      let colIndex = 0;
      doc.text(serialNumber.toString(), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      doc.text(productName, cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      if (withGst) {
        // HSN column only for GST bills
        doc.text((item.hsn_number || '-').toString(), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
        colIndex++;
      }
      
      doc.text(quantity.toString(), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      doc.text('PCS', cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      doc.text(formatCurrency(saleRate), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      doc.text(formatCurrency(itemDiscount), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      doc.text(formatCurrency(priceAfterDiscount), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
      colIndex++;
      
      if (withGst) {
        // Tax Rate column only for GST bills
        let taxRateText = '-';
        if (taxRate > 0) {
          taxRateText = `${taxRate}%`;
        }
        doc.text(taxRateText, cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: cols[colIndex].align });
        colIndex++;
      }
      
      // AMOUNT - last column
      doc.text(formatCurrency(amount), cols[colIndex].x + 2, currentY, { width: cols[colIndex].width - 4, align: 'right' });
      
      currentY += 12;
      doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
      
      serialNumber++;
      
      // Page break check - check if NEXT row would fit, reserve space for totals section
      // Check after drawing current row to maximize space usage
      const rowHeight = 12;
      const spaceNeededForTotals = 150; // Reduced from 200 to use more space (totals section is typically ~150px)
      const minSpaceForNextRow = rowHeight + 8; // Space for next row + padding
      const availableHeight = pageHeight - margin; // Total available height on page
      
      // Only break if we're near the bottom AND there are more items
      // Use more of the page before breaking (reduce reserved space)
      if (serialNumber <= items.length && currentY + minSpaceForNextRow > availableHeight - spaceNeededForTotals) {
        doc.addPage();
        currentY = margin + 20;
        
        // Redraw header
        doc.rect(margin, currentY, contentWidth, 16).fillAndStroke('#e8e8e8', '#000');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
        cols.forEach(col => {
          doc.text(col.label, col.x + 2, currentY + 4, { width: col.width - 4, align: col.align });
        });
        currentY += 16;
        doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
        doc.fontSize(7).font('Helvetica');
      }
    });
    
    // ========== TOTALS SECTION ==========
    currentY += 10;
    
    const totalAmount = parseFloat(transaction.total_amount) || 0; // This is the rounded grand total stored in DB
    const paidAmount = parseFloat(transaction.paid_amount) || 0;
    const previousBalance = parseFloat(transaction.previous_balance || 0) || 0;
    const subtotal = parseFloat(transaction.subtotal || 0);
    const taxAmount = parseFloat(transaction.tax_amount || 0);
    
    // Today's Total Amount = subtotal + tax (without previous balance) - this is unrounded
    const todaysTotalAmount = subtotal + taxAmount;
    
    // Calculate unrounded grand total (Today's Total + Previous Balance)
    // This gives us the actual unrounded total before rounding was applied
    const unroundedGrandTotal = todaysTotalAmount + previousBalance;
    
    // Calculate rounding on the unrounded grand total
    // roundedOff = rounded value - unrounded value
    // If positive: we rounded up (added to customer) → show '+'
    // If negative: we rounded down (subtracted from customer) → show '-'
    const roundedOff = Math.round(unroundedGrandTotal) - unroundedGrandTotal;
    const finalGrandTotal = Math.round(unroundedGrandTotal);
    
    // Use the stored totalAmount (which is already rounded) for consistency
    // But calculate rounding from unrounded values for accurate display
    
    // Discount summary (if any discount exists)
    if (totalDiscount > 0) {
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Discount Summary:', margin, currentY);
      currentY += 12;
      
      doc.font('Helvetica').fontSize(8);
      doc.text('Total Discount Amount:', margin + 10, currentY);
      doc.text(`Rs.${formatCurrency(totalDiscount)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
      currentY += 12;
    }
    
    // Tax summary
    if (withGst && totalCgst > 0) {
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Tax Summary:', margin, currentY);
      currentY += 12;
      
      doc.font('Helvetica').fontSize(8);
      doc.text('Taxable Amount:', margin + 10, currentY);
      doc.text(`Rs.${formatCurrency(totalTaxableValue)}`, margin + 120, currentY);
      
      doc.text('SGST:', margin + 220, currentY);
      doc.text(`Rs.${formatCurrency(totalSgst)}`, margin + 270, currentY);
      
      doc.text('CGST:', margin + 360, currentY);
      doc.text(`Rs.${formatCurrency(totalCgst)}`, margin + 410, currentY);
      
      currentY += 12;
      doc.font('Helvetica-Bold');
      doc.text('Total Tax:', margin + 360, currentY);
      doc.text(`Rs.${formatCurrency(totalCgst + totalSgst)}`, margin + 410, currentY);
      currentY += 15;
    }
    
    // Rounded off
    // roundedOff = Math.round(unroundedGrandTotal) - unroundedGrandTotal
    // If roundedOff > 0: rounded value is higher (we rounded UP, adding to customer) → show '+'
    // If roundedOff < 0: rounded value is lower (we rounded DOWN, subtracting from customer) → show '-'
    // Show rounding if absolute value is greater than 0.001 (to catch small rounding differences)
    if (Math.abs(roundedOff) > 0.001) {
      doc.fontSize(8).font('Helvetica');
      const roundedSign = roundedOff > 0 ? '+' : '-';
      doc.text(`Rounded Off (${roundedSign}):`, margin, currentY);
      doc.text(`Rs.${formatCurrency(Math.abs(roundedOff))}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
      currentY += 12;
    } else {
      // Even if rounding is 0, we might want to show it for clarity
      // But only if the unrounded total is not already a whole number
      const isAlreadyWholeNumber = Math.abs(unroundedGrandTotal - Math.round(unroundedGrandTotal)) < 0.001;
      if (!isAlreadyWholeNumber) {
        // There should be rounding but it's very small, show it anyway
        doc.fontSize(8).font('Helvetica');
        const roundedSign = roundedOff > 0 ? '+' : '-';
        doc.text(`Rounded Off (${roundedSign}):`, margin, currentY);
        doc.text(`Rs.${formatCurrency(Math.abs(roundedOff))}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
        currentY += 12;
      }
    }
    
    // Today's Total Amount
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
    doc.text("Today's Total Amount:", margin, currentY);
    doc.text(`Rs.${formatCurrency(todaysTotalAmount)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
    currentY += 15;
    
    // Total Quantity
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
    doc.text('Total Quantity:', margin, currentY);
    doc.text(`${totalQty.toFixed(2)} PCS`, rightEdge - 80, currentY, { width: 80, align: 'right' });
    currentY += 15;
    
    // Previous balance
    if (previousBalance > 0) {
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Previous Balance:', margin, currentY);
      doc.text(`+Rs.${formatCurrency(previousBalance)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
      currentY += 12;
    }
    
    // Grand total box (Previous Balance + Today's Total Amount)
    currentY += 5;
    doc.rect(margin, currentY, contentWidth, 20).fillAndStroke('#e8e8e8', '#000');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
    doc.text('Grand Total:', margin + 5, currentY + 6);
    doc.text(`Rs.${formatCurrency(finalGrandTotal)}`, rightEdge - 85, currentY + 6, { width: 80, align: 'right' });
    
    currentY += 25;
    
    // Today's payment
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
    doc.text("Today's Payment:", margin, currentY);
    doc.text(`Rs.${formatCurrency(paidAmount)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
    currentY += 15;
    
    // Balance due
    const balanceDue = finalGrandTotal - paidAmount;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Balance Due:', margin, currentY);
    doc.text(`Rs.${formatCurrency(balanceDue)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });
    currentY += 20;
    
    // Amount in words
    doc.rect(margin, currentY, contentWidth, 20).stroke();
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Amount in Words:', margin + 5, currentY + 5);
    doc.font('Helvetica').fontSize(7);
    doc.text(numberToWords(finalGrandTotal), margin + 90, currentY + 5, { width: contentWidth - 95 });
    currentY += 25;
    
    // ========== BANK DETAILS, TERMS & SIGNATURES (Only for GST bills) ==========
    if (withGst) {
      // Calculate space needed for footer section
      const bankBoxHeight = 42;
      const termsTitleHeight = 10;
      const termsLineHeight = 8;
      const termsSpacing = 20;
      const signBoxHeight = 50;
      const signTextHeight = 25; // Space for text below signature boxes
      const totalFooterHeight = bankBoxHeight + 10 + termsTitleHeight + (company.terms_and_conditions.length * termsLineHeight) + termsSpacing + signBoxHeight + signTextHeight;
      
      // Check if we need a new page for footer content
      if (currentY + totalFooterHeight > pageHeight - margin - 30) {
        doc.addPage();
        currentY = margin + 20;
      }
      
      const bankBoxY = currentY + 10;
      
      // Draw title OUTSIDE and ABOVE the box
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Bank Details:', margin, currentY);
      
      // Draw box
      doc.rect(margin, bankBoxY, contentWidth, bankBoxHeight).stroke();
      
      // Put all text INSIDE the box with proper padding
      doc.fontSize(7).font('Helvetica');
      doc.text(`Bank Name: ${company.bank.name}`, margin + 5, bankBoxY + 5, { width: contentWidth - 10 });
      doc.text(`Account No.: ${company.bank.account_number}`, margin + 5, bankBoxY + 16, { width: contentWidth - 10 });
      doc.text(`IFSC CODE: ${company.bank.ifsc_code}`, margin + 5, bankBoxY + 27, { width: contentWidth - 10 });
      
      currentY = bankBoxY + bankBoxHeight + 5;
      
      // Terms - render all on same page
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Terms & Conditions:', margin, currentY);
      currentY += 10;
      doc.fontSize(7).font('Helvetica');
      company.terms_and_conditions.forEach((term, index) => {
        // Check if we need a new page (shouldn't happen, but safety check)
        if (currentY + 8 > pageHeight - margin - signBoxHeight - signTextHeight - 30) {
          doc.addPage();
          currentY = margin + 20;
        }
        doc.text(term, margin, currentY, { width: contentWidth });
        currentY += 8;
      });
      currentY += 20;
      
      // Signatures - FIXED BOXES - ensure they fit on same page
      if (currentY + signBoxHeight + signTextHeight > pageHeight - margin - 30) {
        doc.addPage();
        currentY = margin + 20;
      }
      
      const signBoxWidth = (contentWidth - 20) / 2;
      
      // Left box - Receiver
      doc.rect(margin, currentY, signBoxWidth, signBoxHeight).stroke();
      
      // Right box - Company
      doc.rect(margin + signBoxWidth + 20, currentY, signBoxWidth, signBoxHeight).stroke();
      
      // Text BELOW boxes - render all on same page
      doc.fontSize(7).font('Helvetica-Bold');
      doc.text('Receiver\'s Signature', margin, currentY + signBoxHeight + 5, { 
        width: signBoxWidth, 
        align: 'center' 
      });
      
      // Company text in TWO lines
      doc.text(company.signature.company_name_line1, margin + signBoxWidth + 20, currentY + signBoxHeight + 5, { 
        width: signBoxWidth, 
        align: 'center',
        continued: false
      });
      doc.text(company.signature.company_name_line2, margin + signBoxWidth + 20, currentY + signBoxHeight + 12, { 
        width: signBoxWidth, 
        align: 'center'
      });
      
      doc.fontSize(7).font('Helvetica');
      doc.text(company.signature.authorized_signatory, margin + signBoxWidth + 20, currentY + signBoxHeight + 19, { 
        width: signBoxWidth, 
        align: 'center' 
      });
    }
    
    // Add final page numbers before ending
    pageNumberHelper.addFinalPageNumbers();
    
    if (!isStreamEnded) {
      doc.end();
    }
  } catch (error) {
    console.error('Generate PDF error:', error);
    isStreamEnded = true;
    
    if (doc) {
      try {
        doc.unpipe(res);
        doc.destroy();
      } catch (destroyError) {
        console.error('Error destroying PDF document:', destroyError);
      }
    }
    
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
};

// Generate Return Bill PDF
const generateReturnBillPDF = (returnTransaction, returnItems, party, res) => {
  let doc = null;
  let isStreamEnded = false;
  
  try {
    doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    const rightEdge = margin + contentWidth;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=return_bill_${returnTransaction.bill_number}.pdf`);

    doc.on('error', (error) => {
      console.error('PDF document error:', error);
      if (!isStreamEnded && !res.headersSent) {
        isStreamEnded = true;
        doc.unpipe(res);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate PDF' });
        }
      }
    });

    res.on('error', (error) => {
      console.error('Response stream error:', error);
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
        doc.destroy();
      }
    });

    res.on('close', () => {
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
      }
    });

    doc.pipe(res);

    const company = getCompanyConfig();

    // Set up page numbering
    const pageNumberHelper = addPageNumbers(doc, margin, pageWidth, pageHeight);

    // ========== HEADER ==========
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(company.company_name, margin, margin + 10, {
      width: contentWidth,
      align: 'center'
    });
    
    doc.fontSize(9).font('Helvetica');
    doc.text(company.address, margin, doc.y + 5, { width: contentWidth, align: 'center' });
    doc.text(`Contact: ${company.contact} | Email: ${company.email}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
    
    doc.moveDown(0.3);
    let currentY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('GSTIN:', margin, currentY, { continued: false });
    doc.font('Helvetica');
    doc.text(company.gstin, margin + 50, currentY);
    
    // RETURN BILL BOX
    currentY = doc.y + 10;
    doc.rect(margin, currentY, contentWidth, 30).stroke();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('RETURN BILL', margin, currentY + 10, { width: contentWidth, align: 'center' });
    
    // ========== PARTY & RETURN DETAILS ==========
    currentY = doc.y + 25;
    const boxHeight = 85;
    const leftBoxWidth = 280;
    const rightBoxWidth = contentWidth - leftBoxWidth - 10;
    const rightBoxX = margin + leftBoxWidth + 10;
    
    // Left box - Party details
    doc.rect(margin, currentY, leftBoxWidth, boxHeight).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`${returnTransaction.party_type === 'buyer' ? 'Buyer' : 'Seller'} Details:`, margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    let textY = currentY + 18;
    doc.text(`Name: ${party.party_name || 'N/A'}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    doc.text(`Address: ${(party.address || 'N/A').substring(0, 50)}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    if (party.mobile_number) {
      doc.text(`Mobile No.: ${party.mobile_number}`, margin + 5, textY);
      textY += 12;
    }
    if (party.gst_number) {
      doc.text(`GSTIN / UIN: ${party.gst_number}`, margin + 5, textY);
    }
    
    // Right box - Return details
    doc.rect(rightBoxX, currentY, rightBoxWidth, boxHeight).stroke();
    
    doc.fontSize(8).font('Helvetica');
    textY = currentY + 5;
    const labelWidth = 90;
    
    const details = [
      ['Return Bill No.:', returnTransaction.bill_number],
      ['Return Date:', new Date(returnTransaction.return_date).toLocaleDateString('en-GB')],
      ['Return Type:', returnTransaction.party_type === 'buyer' ? 'Buyer Return' : 'Seller Return'],
      ['Reason:', returnTransaction.reason || 'N/A']
    ];
    
    details.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(label, rightBoxX + 5, textY, { width: labelWidth, continued: false });
      doc.font('Helvetica').text(value, rightBoxX + labelWidth, textY);
      textY += 15;
    });
    
    // ========== ITEMS TABLE ==========
    currentY = currentY + boxHeight + 10;
    
    const cols = [
      { x: margin, width: 28, label: 'S.N.', align: 'center' },
      { x: margin + 28, width: 200, label: 'Description', align: 'left' },
      { x: margin + 228, width: 32, label: 'Qty', align: 'right' },
      { x: margin + 260, width: 55, label: 'Rate', align: 'right' },
      { x: margin + 315, width: 55, label: 'Discount', align: 'right' },
      { x: margin + 370, width: 55, label: 'Amount', align: 'right' }
    ];
    
    // Table header
    doc.rect(margin, currentY, contentWidth, 16).fillAndStroke('#e8e8e8', '#000');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
    cols.forEach(col => {
      doc.text(col.label, col.x + 2, currentY + 4, { width: col.width - 4, align: col.align });
    });
    
    currentY += 16;
    doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
    doc.fontSize(7).font('Helvetica');
    
    let serialNumber = 1;
    let totalQty = 0;
    let totalAmount = 0;
    
    returnItems.forEach(item => {
      const quantity = parseFloat(item.quantity) || 0;
      const returnRate = parseFloat(item.return_rate) || 0;
      const discount = parseFloat(item.discount) || 0;
      const amount = parseFloat(item.total_amount) || 0;
      
      totalQty += quantity;
      totalAmount += amount;
      
      doc.text(serialNumber.toString(), cols[0].x + 2, currentY, { width: cols[0].width - 4, align: cols[0].align });
      doc.text(item.itemDetails?.product_name || 'Item', cols[1].x + 2, currentY, { width: cols[1].width - 4, align: cols[1].align });
      doc.text(quantity.toString(), cols[2].x + 2, currentY, { width: cols[2].width - 4, align: cols[2].align });
      doc.text(`Rs.${formatCurrency(returnRate)}`, cols[3].x + 2, currentY, { width: cols[3].width - 4, align: cols[3].align });
      doc.text(`Rs.${formatCurrency(discount)}`, cols[4].x + 2, currentY, { width: cols[4].width - 4, align: cols[4].align });
      doc.text(`Rs.${formatCurrency(amount)}`, cols[5].x + 2, currentY, { width: cols[5].width - 4, align: cols[5].align });
      
      currentY += 12;
      doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
      serialNumber++;
      
      // Page break check - check if NEXT row would fit, reserve space for totals section
      const rowHeight = 12;
      const spaceNeededForTotals = 120; // Reduced to use more space (return bill totals are typically ~120px)
      const minSpaceForNextRow = rowHeight + 8; // Space for next row + padding
      const availableHeight = pageHeight - margin; // Total available height on page
      
      // Only break if we're near the bottom AND there are more items
      // Use more of the page before breaking (reduce reserved space)
      if (serialNumber <= returnItems.length && currentY + minSpaceForNextRow > availableHeight - spaceNeededForTotals) {
        doc.addPage();
        currentY = margin + 20;
        doc.rect(margin, currentY, contentWidth, 16).fillAndStroke('#e8e8e8', '#000');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
        cols.forEach(col => {
          doc.text(col.label, col.x + 2, currentY + 4, { width: col.width - 4, align: col.align });
        });
        currentY += 16;
        doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
        doc.fontSize(7).font('Helvetica');
      }
    });
    
    // ========== TOTALS SECTION ==========
    currentY += 10;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Total Quantity: ${totalQty.toFixed(2)} PCS`, margin, currentY);
    doc.text('Total Return Amount:', rightEdge - 120, currentY, { width: 80, align: 'right' });
    doc.text(`Rs.${formatCurrency(totalAmount)}`, rightEdge - 40, currentY, { width: 40, align: 'right' });
    
    currentY += 20;
    
    // Amount in words
    doc.rect(margin, currentY, contentWidth, 20).stroke();
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Amount in Words:', margin + 5, currentY + 5);
    doc.font('Helvetica').fontSize(7);
    doc.text(numberToWords(totalAmount), margin + 90, currentY + 5, { width: contentWidth - 95 });
    
    currentY += 30;
    
    // Signatures
    const signBoxWidth = (contentWidth - 20) / 2;
    const signBoxHeight = 50;
    
    doc.rect(margin, currentY, signBoxWidth, signBoxHeight).stroke();
    doc.rect(margin + signBoxWidth + 20, currentY, signBoxWidth, signBoxHeight).stroke();
    
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Receiver\'s Signature', margin, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center' 
    });
    
    doc.text(company.signature.company_name_line1, margin + signBoxWidth + 20, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center'
    });
    doc.text(company.signature.company_name_line2, margin + signBoxWidth + 20, currentY + signBoxHeight + 12, { 
      width: signBoxWidth, 
      align: 'center'
    });
    
    doc.fontSize(7).font('Helvetica');
    doc.text(company.signature.authorized_signatory, margin + signBoxWidth + 20, currentY + signBoxHeight + 19, { 
      width: signBoxWidth, 
      align: 'center' 
    });
    
    // Add final page numbers before ending
    pageNumberHelper.addFinalPageNumbers();
    
    if (!isStreamEnded) {
      doc.end();
    }
  } catch (error) {
    console.error('Generate Return Bill PDF error:', error);
    isStreamEnded = true;
    
    if (doc) {
      try {
        doc.unpipe(res);
        doc.destroy();
      } catch (destroyError) {
        console.error('Error destroying PDF document:', destroyError);
      }
    }
    
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
};

// Generate Payment Receipt PDF
const generatePaymentReceiptPDF = (paymentTransaction, party, res) => {
  let doc = null;
  let isStreamEnded = false;
  
  try {
    doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    const rightEdge = margin + contentWidth;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payment_receipt_${paymentTransaction.receipt_number}.pdf`);

    doc.on('error', (error) => {
      console.error('PDF document error:', error);
      if (!isStreamEnded && !res.headersSent) {
        isStreamEnded = true;
        doc.unpipe(res);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate PDF' });
        }
      }
    });

    res.on('error', (error) => {
      console.error('Response stream error:', error);
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
        doc.destroy();
      }
    });

    res.on('close', () => {
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
      }
    });

    doc.pipe(res);

    const company = getCompanyConfig();

    // Set up page numbering
    const pageNumberHelper = addPageNumbers(doc, margin, pageWidth, pageHeight);

    // ========== HEADER ==========
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(company.company_name, margin, margin + 10, {
      width: contentWidth,
      align: 'center'
    });
    
    doc.fontSize(9).font('Helvetica');
    doc.text(company.address, margin, doc.y + 5, { width: contentWidth, align: 'center' });
    doc.text(`Contact: ${company.contact} | Email: ${company.email}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
    
    doc.moveDown(0.3);
    let currentY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('GSTIN:', margin, currentY, { continued: false });
    doc.font('Helvetica');
    doc.text(company.gstin, margin + 50, currentY);
    
    // PAYMENT RECEIPT BOX
    currentY = doc.y + 10;
    doc.rect(margin, currentY, contentWidth, 30).stroke();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('PAYMENT RECEIPT', margin, currentY + 10, { width: contentWidth, align: 'center' });
    
    // ========== PARTY & PAYMENT DETAILS ==========
    currentY = doc.y + 25;
    const boxHeight = 100;
    const leftBoxWidth = 280;
    const rightBoxWidth = contentWidth - leftBoxWidth - 10;
    const rightBoxX = margin + leftBoxWidth + 10;
    
    // Left box - Party details
    doc.rect(margin, currentY, leftBoxWidth, boxHeight).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`${paymentTransaction.party_type === 'buyer' ? 'Buyer' : 'Seller'} Details:`, margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    let textY = currentY + 18;
    doc.text(`Name: ${party.party_name || 'N/A'}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    doc.text(`Address: ${(party.address || 'N/A').substring(0, 50)}`, margin + 5, textY, { width: leftBoxWidth - 10 });
    textY += 12;
    if (party.mobile_number) {
      doc.text(`Mobile No.: ${party.mobile_number}`, margin + 5, textY);
      textY += 12;
    }
    if (party.gst_number) {
      doc.text(`GSTIN / UIN: ${party.gst_number}`, margin + 5, textY);
    }
    
    // Right box - Payment details
    doc.rect(rightBoxX, currentY, rightBoxWidth, boxHeight).stroke();
    
    doc.fontSize(8).font('Helvetica');
    textY = currentY + 5;
    const labelWidth = 100;
    
    // Use created_at for full timestamp, fallback to payment_date if not available
    const paymentDateTime = paymentTransaction.created_at || paymentTransaction.payment_date;
    const formattedDateTime = new Date(paymentDateTime).toLocaleString('en-GB', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    const details = [
      ['Receipt No.:', paymentTransaction.receipt_number],
      ['Payment Date & Time:', formattedDateTime],
      ['Payment Method:', paymentTransaction.payment_method || 'Cash']
    ];
    
    details.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').text(label, rightBoxX + 5, textY, { width: labelWidth, continued: false });
      doc.font('Helvetica').text(value, rightBoxX + labelWidth, textY);
      textY += 12;
    });
    
    // ========== PAYMENT SUMMARY ==========
    currentY = currentY + boxHeight + 20;
    doc.rect(margin, currentY, contentWidth, 100).stroke();
    
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('PAYMENT SUMMARY', margin + 5, currentY + 10, { width: contentWidth - 10, align: 'center' });
    
    currentY += 30;
    doc.fontSize(9).font('Helvetica');
    
    const previousBalance = parseFloat(paymentTransaction.previous_balance) || 0;
    const paymentAmount = parseFloat(paymentTransaction.amount) || 0;
    const updatedBalance = parseFloat(paymentTransaction.updated_balance) || 0;
    
    doc.font('Helvetica-Bold').text('Previous Balance:', margin + 20, currentY);
    doc.font('Helvetica').text(`Rs.${formatCurrency(previousBalance)}`, rightEdge - 100, currentY, { width: 80, align: 'right' });
    
    currentY += 20;
    doc.font('Helvetica-Bold').text('Payment Amount:', margin + 20, currentY);
    doc.font('Helvetica').text(`Rs.${formatCurrency(paymentAmount)}`, rightEdge - 100, currentY, { width: 80, align: 'right' });
    
    currentY += 20;
    doc.moveTo(margin + 20, currentY).lineTo(rightEdge - 20, currentY).stroke();
    currentY += 10;
    
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Updated Balance:', margin + 20, currentY);
    doc.text(`Rs.${formatCurrency(updatedBalance)}`, rightEdge - 100, currentY, { width: 80, align: 'right' });
    
    currentY += 30;
    
    // Amount in words
    doc.rect(margin, currentY, contentWidth, 20).stroke();
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Amount in Words:', margin + 5, currentY + 5);
    doc.font('Helvetica').fontSize(7);
    doc.text(numberToWords(paymentAmount), margin + 90, currentY + 5, { width: contentWidth - 95 });
    
    currentY += 30;
    
    // Notes
    if (paymentTransaction.notes) {
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Notes:', margin, currentY);
      doc.font('Helvetica').fontSize(7);
      doc.text(paymentTransaction.notes, margin, currentY + 12, { width: contentWidth });
      currentY += 30;
    }
    
    // Signatures
    const signBoxWidth = (contentWidth - 20) / 2;
    const signBoxHeight = 50;
    
    doc.rect(margin, currentY, signBoxWidth, signBoxHeight).stroke();
    doc.rect(margin + signBoxWidth + 20, currentY, signBoxWidth, signBoxHeight).stroke();
    
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Receiver\'s Signature', margin, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center' 
    });
    
    doc.text(company.signature.company_name_line1, margin + signBoxWidth + 20, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center'
    });
    doc.text(company.signature.company_name_line2, margin + signBoxWidth + 20, currentY + signBoxHeight + 12, { 
      width: signBoxWidth, 
      align: 'center'
    });
    
    doc.fontSize(7).font('Helvetica');
    doc.text(company.signature.authorized_signatory, margin + signBoxWidth + 20, currentY + signBoxHeight + 19, { 
      width: signBoxWidth, 
      align: 'center' 
    });
    
    // Add final page numbers before ending
    pageNumberHelper.addFinalPageNumbers();
    
    if (!isStreamEnded) {
      doc.end();
    }
  } catch (error) {
    console.error('Generate Payment Receipt PDF error:', error);
    isStreamEnded = true;
    
    if (doc) {
      try {
        doc.unpipe(res);
        doc.destroy();
      } catch (destroyError) {
        console.error('Error destroying PDF document:', destroyError);
      }
    }
    
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
};

// Generate Small Return Receipt (compact format)
const generateReturnReceiptPDF = (returnTransaction, returnItems, party, res) => {
  let doc = null;
  let isStreamEnded = false;
  
  try {
    doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    const rightEdge = margin + contentWidth;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=return_receipt_${returnTransaction.bill_number || returnTransaction.id}.pdf`);

    doc.on('error', (error) => {
      console.error('PDF document error:', error);
      if (!isStreamEnded && !res.headersSent) {
        isStreamEnded = true;
        doc.unpipe(res);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate PDF' });
        }
      }
    });

    res.on('error', (error) => {
      console.error('Response stream error:', error);
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
        doc.destroy();
      }
    });

    res.on('close', () => {
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
      }
    });

    doc.pipe(res);

    const company = getCompanyConfig();

    // Set up page numbering
    const pageNumberHelper = addPageNumbers(doc, margin, pageWidth, pageHeight);

    let currentY = margin + 10;

    // ========== COMPANY HEADER ==========
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(company.company_name, margin, currentY, {
      width: contentWidth,
      align: 'center'
    });
    
    doc.fontSize(9).font('Helvetica');
    doc.text(company.address, margin, doc.y + 5, { width: contentWidth, align: 'center' });
    doc.text(`Contact: ${company.contact} | Email: ${company.email}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
    
    doc.moveDown(0.3);
    currentY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('GSTIN:', margin, currentY, { continued: false });
    doc.font('Helvetica');
    doc.text(company.gstin, margin + 50, currentY);
    
    currentY = doc.y + 15;

    // Title
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text('RETURN RECEIPT', margin, currentY, { width: contentWidth, align: 'center' });
    currentY += 25;

    // Return Details Box
    doc.rect(margin, currentY, contentWidth, 80).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Return Details:', margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    let textY = currentY + 18;
    doc.text(`Return Bill No.: ${returnTransaction.bill_number || 'N/A'}`, margin + 5, textY);
    textY += 12;
    doc.text(`Date: ${new Date(returnTransaction.return_date || returnTransaction.created_at).toLocaleDateString('en-GB')}`, margin + 5, textY);
    textY += 12;
    doc.text(`Party: ${party.party_name || 'N/A'}`, margin + 5, textY);
    textY += 12;
    doc.text(`Type: ${returnTransaction.party_type === 'buyer' ? 'Buyer Return' : 'Seller Return'}`, margin + 5, textY);
    
    currentY += 90;

    // Items Table
    const cols = [
      { x: margin, width: 30, label: 'S.N.', align: 'center' },
      { x: margin + 30, width: 200, label: 'Item', align: 'left' },
      { x: margin + 230, width: 50, label: 'Qty', align: 'right' },
      { x: margin + 280, width: 80, label: 'Rate', align: 'right' },
      { x: margin + 360, width: 95, label: 'Amount', align: 'right' }
    ];

    doc.rect(margin, currentY, contentWidth, 16).fillAndStroke('#e8e8e8', '#000');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
    cols.forEach(col => {
      doc.text(col.label, col.x + 2, currentY + 4, { width: col.width - 4, align: col.align });
    });

    currentY += 16;
    doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
    doc.fontSize(7).font('Helvetica').fillColor('#000');

    let serialNumber = 1;
    let totalAmount = 0;

    returnItems.forEach(item => {
      const quantity = parseFloat(item.quantity) || 0;
      const returnRate = parseFloat(item.return_rate) || 0;
      const amount = parseFloat(item.total_amount) || 0;
      totalAmount += amount;

      // Add spacing before drawing item text
      currentY += 4;
      
      doc.text(serialNumber.toString(), cols[0].x + 2, currentY, { width: cols[0].width - 4, align: cols[0].align });
      doc.text((item.itemDetails?.product_name || item.product_name || 'Item').substring(0, 30), cols[1].x + 2, currentY, { width: cols[1].width - 4, align: cols[1].align });
      doc.text(quantity.toString(), cols[2].x + 2, currentY, { width: cols[2].width - 4, align: cols[2].align });
      doc.text(`Rs.${formatCurrency(returnRate)}`, cols[3].x + 2, currentY, { width: cols[3].width - 4, align: cols[3].align });
      doc.text(`Rs.${formatCurrency(amount)}`, cols[4].x + 2, currentY, { width: cols[4].width - 4, align: cols[4].align });

      // Add spacing after item text before drawing line
      currentY += 8;
      doc.moveTo(margin, currentY).lineTo(rightEdge, currentY).stroke();
      serialNumber++;
    });

    // Total
    currentY += 10;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Total Return Amount:', margin, currentY);
    doc.text(`Rs.${formatCurrency(totalAmount)}`, rightEdge - 80, currentY, { width: 80, align: 'right' });

    currentY += 20;

    // Balance Adjustment Information - Always show if data is available
    const previousBalance = parseFloat(returnTransaction.previous_balance || returnTransaction.warning?.current_balance || 0);
    const adjustmentAmount = parseFloat(returnTransaction.warning?.adjustment_amount || returnTransaction.adjustment_amount || 0);
    const newBalance = parseFloat(returnTransaction.warning?.new_balance || returnTransaction.new_balance || 0);
    const cashPaymentRequired = parseFloat(returnTransaction.warning?.cash_payment_required || 0);
    
    // Show balance section if we have any balance information
    if (previousBalance !== 0 || adjustmentAmount !== 0 || newBalance !== 0 || returnTransaction.previous_balance !== undefined) {
      currentY += 5;
      doc.rect(margin, currentY, contentWidth, 100).stroke();
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Balance Adjustment:', margin + 5, currentY + 5);
      
      doc.fontSize(8).font('Helvetica');
      let balanceY = currentY + 18;
      
      // Always show previous balance
      doc.text(`Previous Balance: Rs.${formatCurrency(previousBalance)}`, margin + 5, balanceY);
      balanceY += 12;
      
      // Show adjustment amount if applicable
      if (adjustmentAmount > 0) {
        doc.text(`Adjusted in Account: Rs.${formatCurrency(adjustmentAmount)}`, margin + 5, balanceY);
        balanceY += 12;
      }
      
      // Always show new balance
      doc.font('Helvetica-Bold');
      doc.text(`New Balance: Rs.${formatCurrency(newBalance)}`, margin + 5, balanceY);
      balanceY += 12;
      
      // Show cash payment required if applicable
      if (cashPaymentRequired > 0) {
        doc.font('Helvetica-Bold').fillColor('#d32f2f');
        doc.text(`Cash Payment Required: Rs.${formatCurrency(cashPaymentRequired)}`, margin + 5, balanceY);
        doc.fillColor('#000');
        balanceY += 12;
      }
      
      currentY += 110;
    }

    // Amount in words
    doc.rect(margin, currentY, contentWidth, 20).stroke();
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Amount in Words:', margin + 5, currentY + 5);
    doc.font('Helvetica').fontSize(7);
    doc.text(numberToWords(totalAmount), margin + 90, currentY + 5, { width: contentWidth - 95 });

    // Add final page numbers before ending
    pageNumberHelper.addFinalPageNumbers();

    if (!isStreamEnded) {
      doc.end();
    }
  } catch (error) {
    console.error('Generate Return Receipt PDF error:', error);
    isStreamEnded = true;
    
    if (doc) {
      try {
        doc.unpipe(res);
        doc.destroy();
      } catch (destroyError) {
        console.error('Error destroying PDF document:', destroyError);
      }
    }
    
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
};

// Generate Small Payment Receipt (compact format)
const generatePaymentReceiptSmallPDF = (paymentTransaction, party, res) => {
  let doc = null;
  let isStreamEnded = false;
  
  try {
    doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);
    const rightEdge = margin + contentWidth;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payment_receipt_${paymentTransaction.receipt_number || paymentTransaction.id}.pdf`);

    doc.on('error', (error) => {
      console.error('PDF document error:', error);
      if (!isStreamEnded && !res.headersSent) {
        isStreamEnded = true;
        doc.unpipe(res);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate PDF' });
        }
      }
    });

    res.on('error', (error) => {
      console.error('Response stream error:', error);
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
        doc.destroy();
      }
    });

    res.on('close', () => {
      isStreamEnded = true;
      if (doc) {
        doc.unpipe(res);
      }
    });

    doc.pipe(res);

    const company = getCompanyConfig();

    // Set up page numbering
    const pageNumberHelper = addPageNumbers(doc, margin, pageWidth, pageHeight);

    let currentY = margin + 10;

    // ========== COMPANY HEADER ==========
    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(company.company_name, margin, currentY, {
      width: contentWidth,
      align: 'center'
    });
    
    doc.fontSize(9).font('Helvetica');
    doc.text(company.address, margin, doc.y + 5, { width: contentWidth, align: 'center' });
    doc.text(`Contact: ${company.contact} | Email: ${company.email}`, margin, doc.y + 2, { width: contentWidth, align: 'center' });
    
    doc.moveDown(0.3);
    currentY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('GSTIN:', margin, currentY, { continued: false });
    doc.font('Helvetica');
    doc.text(company.gstin, margin + 50, currentY);
    
    currentY += 20;

    // Title
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text('PAYMENT RECEIPT', margin, currentY, { width: contentWidth, align: 'center' });
    currentY += 25;

    // Payment Details Box
    doc.rect(margin, currentY, contentWidth, 100).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Payment Details:', margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    let textY = currentY + 18;
    doc.text(`Receipt No.: ${paymentTransaction.receipt_number || 'N/A'}`, margin + 5, textY);
    textY += 12;
    // Use created_at for full timestamp, fallback to payment_date if not available
    const paymentDateTime = paymentTransaction.created_at || paymentTransaction.payment_date;
    const formattedDateTime = new Date(paymentDateTime).toLocaleString('en-GB', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    doc.text(`Date & Time: ${formattedDateTime}`, margin + 5, textY);
    textY += 12;
    doc.text(`Party: ${party.party_name || 'N/A'}`, margin + 5, textY);
    textY += 12;
    doc.text(`Payment Method: ${paymentTransaction.payment_method || 'Cash'}`, margin + 5, textY);
    
    currentY += 110;

    // Payment Summary Box
    doc.rect(margin, currentY, contentWidth, 80).stroke();
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Payment Summary:', margin + 5, currentY + 5);
    
    doc.fontSize(8).font('Helvetica');
    textY = currentY + 18;
    
    const previousBalance = parseFloat(paymentTransaction.previous_balance) || 0;
    const paymentAmount = parseFloat(paymentTransaction.amount) || 0;
    const updatedBalance = parseFloat(paymentTransaction.updated_balance) || 0;
    
    doc.font('Helvetica-Bold').text('Previous Balance:', margin + 5, textY);
    doc.font('Helvetica').text(`Rs.${formatCurrency(previousBalance)}`, rightEdge - 100, textY, { width: 80, align: 'right' });
    textY += 15;
    
    doc.font('Helvetica-Bold').text('Payment Amount:', margin + 5, textY);
    doc.font('Helvetica').text(`Rs.${formatCurrency(paymentAmount)}`, rightEdge - 100, textY, { width: 80, align: 'right' });
    textY += 15;
    
    doc.moveTo(margin + 5, textY).lineTo(rightEdge - 5, textY).stroke();
    textY += 10;
    
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Updated Balance:', margin + 5, textY);
    doc.text(`Rs.${formatCurrency(updatedBalance)}`, rightEdge - 100, textY, { width: 80, align: 'right' });
    
    currentY += 90;

    // Amount in words
    doc.rect(margin, currentY, contentWidth, 20).stroke();
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Amount in Words:', margin + 5, currentY + 5);
    doc.font('Helvetica').fontSize(7);
    doc.text(numberToWords(paymentAmount), margin + 90, currentY + 5, { width: contentWidth - 95 });

    currentY += 30;

    // Signatures
    const signBoxWidth = (contentWidth - 20) / 2;
    const signBoxHeight = 50;
    
    doc.rect(margin, currentY, signBoxWidth, signBoxHeight).stroke();
    doc.rect(margin + signBoxWidth + 20, currentY, signBoxWidth, signBoxHeight).stroke();
    
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Receiver\'s Signature', margin, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center' 
    });
    
    doc.text(company.signature.company_name_line1, margin + signBoxWidth + 20, currentY + signBoxHeight + 5, { 
      width: signBoxWidth, 
      align: 'center'
    });
    doc.text(company.signature.company_name_line2, margin + signBoxWidth + 20, currentY + signBoxHeight + 12, { 
      width: signBoxWidth, 
      align: 'center'
    });
    
    doc.fontSize(7).font('Helvetica');
    doc.text(company.signature.authorized_signatory, margin + signBoxWidth + 20, currentY + signBoxHeight + 19, { 
      width: signBoxWidth, 
      align: 'center' 
    });

    // Add final page numbers before ending
    pageNumberHelper.addFinalPageNumbers();

    if (!isStreamEnded) {
      doc.end();
    }
  } catch (error) {
    console.error('Generate Payment Receipt Small PDF error:', error);
    isStreamEnded = true;
    
    if (doc) {
      try {
        doc.unpipe(res);
        doc.destroy();
      } catch (destroyError) {
        console.error('Error destroying PDF document:', destroyError);
      }
    }
    
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
};

module.exports = { generateBillPDF, generateReturnBillPDF, generatePaymentReceiptPDF, generateReturnReceiptPDF, generatePaymentReceiptSmallPDF };