import { buildVisibleInvoicesWhere } from "@/lib/auth/session";
import { round2 } from "@/lib/budget/calculator";
import { prisma } from "@/lib/prisma";

export async function formatQuotesForProject(
  projectId: string,
  currentUser: { id: string } | null
) {
  const quotes = await prisma.quote.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      projectId: true,
      budgetLineId: true,
      quoteNumber: true,
      vendorName: true,
      description: true,
      issueDate: true,
      validUntil: true,
      amountHt: true,
      tvaAmount: true,
      amountTtc: true,
      status: true,
      originalFilename: true,
      localPdfPath: true,
      driveFileId: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      budgetLine: {
        select: { id: true, category: true, objet: true },
      },
      invoices: {
        where: buildVisibleInvoicesWhere(projectId, currentUser),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          invoiceNumber: true,
          vendorName: true,
          invoiceDate: true,
          amountHt: true,
          amountTtc: true,
          status: true,
          renamedFilename: true,
          originalFilename: true,
          driveFileId: true,
          budgetLineId: true,
        },
      },
    },
  });

  // Check which quotes have binary pdfData without loading the bytes
  const quotesWithBlob = await prisma.quote.findMany({
    where: { projectId, pdfData: { not: null } },
    select: { id: true },
  });
  const blobSet = new Set(quotesWithBlob.map((q) => q.id));

  return quotes.map((q) => {
    const activeInvoices = q.invoices.filter(
      (inv) => inv.status !== "REJECTED" && inv.status !== "CONFLICT_BLOCKED"
    );
    const invoicedTotalHt = round2(
      activeInvoices.reduce((sum, inv) => sum + (inv.amountHt || 0), 0)
    );
    const remainingHt = round2(q.amountHt - invoicedTotalHt);
    const invoicedPct =
      q.amountHt > 0
        ? Math.round((invoicedTotalHt / q.amountHt) * 100)
        : invoicedTotalHt > 0
          ? 100
          : 0;

    return {
      ...q,
      hasPdf: Boolean(q.driveFileId || blobSet.has(q.id) || q.localPdfPath),
      invoicedTotalHt,
      remainingHt,
      invoicedPct,
      overQuote: invoicedTotalHt > 0 && invoicedTotalHt > q.amountHt,
    };
  });
}
