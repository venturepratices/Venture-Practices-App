import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Service } from "@/lib/validations/client-order";

// @react-pdf/renderer's primitives (View/Text/StyleSheet) are its own PDF
// layout engine, not HTML/CSS — deliberately a separate small component from
// the in-app styled document view, not a reuse of that JSX.
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { marginBottom: 24 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#555555" },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  tableHeaderRow: { flexDirection: "row", borderBottom: "1px solid #1a1a1a", paddingBottom: 4, marginBottom: 4 },
  tableRow: { flexDirection: "row", paddingVertical: 3, borderBottom: "1px solid #e5e5e5" },
  colName: { flex: 3 },
  colFee: { flex: 1, textAlign: "right" },
  colStatus: { flex: 1, textAlign: "right" },
  headerCell: { fontWeight: 700 },
  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8, gap: 8 },
  fieldRow: { flexDirection: "row", marginBottom: 4 },
  fieldLabel: { width: 160, fontWeight: 700 },
  fieldValue: { flex: 1 },
  notes: { lineHeight: 1.5 },
});

type CustomFieldValue = { key: string; label: string; type: string; value: string | null };

export type OrderPdfData = {
  clientName: string;
  type: "ORDER" | "CHANGE_ORDER";
  sequenceNumber: number;
  title: string | null;
  services: Service[];
  adBudgetCents: number | null;
  notes: string | null;
  customFieldValues: CustomFieldValue[];
  createdByName: string | null;
  createdAt: Date;
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const SERVICE_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled" };

export function OrderPdfDocument({ order }: { order: OrderPdfData }) {
  const docLabel = order.type === "ORDER" ? `Order #${order.sequenceNumber}` : `Change Order #${order.sequenceNumber}`;
  const activeTotalCents = order.services
    .filter((s) => s.status === "ACTIVE")
    .reduce((sum, s) => sum + s.feeCents, 0);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{docLabel}</Text>
          <Text style={styles.subtitle}>{order.clientName}</Text>
          {order.title ? <Text style={styles.subtitle}>{order.title}</Text> : null}
          <Text style={styles.subtitle}>
            {order.createdAt.toLocaleDateString("en-US")}
            {order.createdByName ? ` · Created by ${order.createdByName}` : ""}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colName, styles.headerCell]}>Service</Text>
            <Text style={[styles.colFee, styles.headerCell]}>Fee</Text>
            <Text style={[styles.colStatus, styles.headerCell]}>Status</Text>
          </View>
          {order.services.map((service, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.colName}>{service.name}</Text>
              <Text style={styles.colFee}>{formatMoney(service.feeCents)}/mo</Text>
              <Text style={styles.colStatus}>{SERVICE_STATUS_LABEL[service.status] ?? service.status}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={{ fontWeight: 700 }}>Total (active): {formatMoney(activeTotalCents)}/mo</Text>
          </View>
        </View>

        {order.adBudgetCents != null ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ad Budget</Text>
            <Text>{formatMoney(order.adBudgetCents)}/mo</Text>
          </View>
        ) : null}

        {order.customFieldValues.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Details</Text>
            {order.customFieldValues.map((field) => (
              <View key={field.key} style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <Text style={styles.fieldValue}>{field.value ?? "—"}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {order.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notes}>{order.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
