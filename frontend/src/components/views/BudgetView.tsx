import * as React from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { THAI_MONTHS } from "@/lib/utils"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Plus,
  Users,
  Trash2,
  Pencil,
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  ArrowDownToLine,
  RefreshCw,
  Receipt,
  Calendar,
} from "lucide-react"

const DEFAULT_WEBSITES = [
  "ReadRealm แปลจนเมื่อย",
  "ReadRealm น้องแมวส้ม",
  "ReadRealm แปลแล้วแปลอีก",
  "ReadRealm แปลจนแขนหัก",
]

interface BudgetViewProps {
  payeeList: any[]
  transactionList: any[]
  websiteList: string[]
  onPayeesChange: (newPayees: any[]) => void
  onTransactionsChange: (newTrans: any[]) => void
}

export function BudgetView({
  payeeList,
  transactionList,
  websiteList,
  onPayeesChange,
  onTransactionsChange,
}: BudgetViewProps) {
  const now = new Date()
  const [monthFilter, setMonthFilter] = React.useState(
    String(now.getMonth() + 1)
  )
  const [yearFilter, setYearFilter] = React.useState("all")
  const [typeFilter, setTypeFilter] = React.useState("all")

  // Transaction Modal
  const [transOpen, setTransOpen] = React.useState(false)
  const [transDate, setTransDate] = React.useState(
    now.toISOString().split("T")[0]
  )
  const [transType, setTransType] = React.useState<"Income" | "Expense">(
    "Income"
  )
  const [transCategory, setTransCategory] = React.useState("")
  const [transReference, setTransReference] = React.useState("")
  const [transAmount, setTransAmount] = React.useState("")
  const [transNote, setTransNote] = React.useState("")
  const [submittingTrans, setSubmittingTrans] = React.useState(false)

  // Payee Modal
  const [payeeModalOpen, setPayeeModalOpen] = React.useState(false)
  const [showPayeeForm, setShowPayeeForm] = React.useState(false)
  const [editPayeeId, setEditPayeeId] = React.useState("")
  const [payeeName, setPayeeName] = React.useState("")
  const [payeeTaxId, setPayeeTaxId] = React.useState("")
  const [payeeBankAccount, setPayeeBankAccount] = React.useState("")
  const [payeeBankName, setPayeeBankName] = React.useState("")
  const [payeeNote, setPayeeNote] = React.useState("")
  const [submittingPayee, setSubmittingPayee] = React.useState(false)

  const combinedWebsites = React.useMemo(() => {
    const list = [...DEFAULT_WEBSITES]
    ;(websiteList || []).forEach((w) => {
      const isPlaceholder =
        w === "Other" || w === "ช่องทาง Readrealm" || w === "Readrealm"
      if (w && !list.includes(w) && !isPlaceholder) {
        list.push(w)
      }
    })
    return list
  }, [websiteList])

  const filteredTransactions = React.useMemo(() => {
    let list = [...(transactionList || [])]
    if (monthFilter !== "all" || yearFilter !== "all") {
      list = list.filter((t) => {
        if (!t.date) return false
        const d = new Date(t.date)
        if (isNaN(d.getTime())) return false
        const mMatch =
          monthFilter === "all" || String(d.getMonth() + 1) === monthFilter
        const yMatch =
          yearFilter === "all" || String(d.getFullYear()) === yearFilter
        return mMatch && yMatch
      })
    }
    if (typeFilter !== "all") {
      list = list.filter((t) => t.type === typeFilter)
    }
    list.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    return list
  }, [transactionList, monthFilter, yearFilter, typeFilter])

  const stats = React.useMemo(() => {
    let income = 0
    let expenses = 0
    filteredTransactions.forEach((t) => {
      if (t.type === "Income") income += parseFloat(t.amount) || 0
      else expenses += parseFloat(t.amount) || 0
    })

    // 3% WHT from expenses
    const tax3 = expenses * 0.03
    const remainingBeforeFund = income - expenses - tax3
    const centralFund = remainingBeforeFund > 0 ? remainingBeforeFund * 0.1 : 0
    const netProfit = remainingBeforeFund - centralFund

    return { income, expenses, tax3, netProfit }
  }, [filteredTransactions])

  const handleOpenAddTrans = () => {
    setTransDate(new Date().toISOString().split("T")[0])
    setTransType("Income")
    setTransCategory("")
    setTransReference("")
    setTransAmount("")
    setTransNote("")
    setTransOpen(true)
  }

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!transCategory || !transAmount) {
      toast.warning("กรุณากรอกหมวดหมู่และจำนวนเงิน")
      return
    }
    setSubmittingTrans(true)
    try {
      const res = await callGasApi("ADD_BUDGET_TRANSACTION", {
        date: transDate,
        type: transType,
        category: transCategory,
        reference: transReference,
        amount: transAmount,
        note: transNote,
      })
      toast.success("บันทึกรายการบัญชีเรียบร้อย")
      onTransactionsChange(res.transactions || [])
      setTransOpen(false)
    } catch (err: any) {
      toast.error(err.message || "บันทึกรายการไม่สำเร็จ")
    } finally {
      setSubmittingTrans(false)
    }
  }

  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm("ยืนยันการลบรายการบัญชีนี้หรือไม่?")) return
    try {
      const res = await callGasApi("DELETE_BUDGET_TRANSACTION", { id })
      toast.success("ลบรายการเรียบร้อย")
      onTransactionsChange(res.transactions || [])
    } catch (err: any) {
      toast.error(err.message || "ลบรายการไม่สำเร็จ")
    }
  }

  const handleSavePayee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payeeName.trim() || !payeeTaxId.trim()) return
    setSubmittingPayee(true)
    try {
      const data = {
        name: payeeName.trim(),
        taxid: payeeTaxId.trim(),
        bankaccount: payeeBankAccount.trim(),
        bankname: payeeBankName.trim(),
        note: payeeNote.trim(),
      }
      if (editPayeeId) {
        const res = await callGasApi("UPDATE_BUDGET_PAYEE", {
          id: editPayeeId,
          data,
        })
        toast.success("อัปเดตข้อมูลผู้รับเงินเรียบร้อย")
        onPayeesChange(res.payees || [])
      } else {
        const res = await callGasApi("ADD_BUDGET_PAYEE", data)
        toast.success("เพิ่มรายชื่อผู้รับเงินเรียบร้อย")
        onPayeesChange(res.payees || [])
      }
      setShowPayeeForm(false)
    } catch (err: any) {
      toast.error(err.message || "บันทึกข้อมูลผู้รับเงินไม่สำเร็จ")
    } finally {
      setSubmittingPayee(false)
    }
  }

  const handleDeletePayee = async (id: string) => {
    if (!window.confirm("ยืนยันการลบรายชื่อผู้รับเงินนี้หรือไม่?")) return
    try {
      const res = await callGasApi("DELETE_BUDGET_PAYEE", { id })
      toast.success("ลบข้อมูลเรียบร้อย")
      onPayeesChange(res.payees || [])
    } catch (err: any) {
      toast.error(err.message || "ลบข้อมูลไม่สำเร็จ")
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">งบประมาณและบัญชี</h2>
          <p className="text-sm text-slate-400">
            ต้นทุน: รายรับ - รายจ่าย(เต็ม) - ภาษี(3% ของจ่าย) และหักเข้ากองกลาง
            10%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowPayeeForm(false)
              setPayeeModalOpen(true)
            }}
          >
            <Users className="h-4 w-4" /> จัดการรายชื่อผู้รับเงิน
          </Button>
          <Button variant="emerald" onClick={handleOpenAddTrans}>
            <Plus className="h-4 w-4" /> เพิ่มรายการ
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">รายได้รวม</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {stats.income.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{" "}
              ฿
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <TrendingUp className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">รายจ่ายรวม (เต็ม)</p>
            <p className="text-2xl font-bold text-red-400 mt-1">
              {stats.expenses.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{" "}
              ฿
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
            <TrendingDown className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">กำไรสุทธิ (หัก 10%)</p>
            <p className="text-2xl font-bold text-indigo-400 mt-1">
              {stats.netProfit.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{" "}
              ฿
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
            <Wallet className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-5 flex items-center justify-between border-amber-500/40 bg-amber-500/10">
          <div>
            <p className="text-xs text-amber-300 font-medium">
              ภาษีนำส่ง (3%)
            </p>
            <p className="text-2xl font-bold text-amber-300 mt-1">
              {stats.tax3.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{" "}
              ฿
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
            <Landmark className="h-6 w-6" />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-slate-300">
          🔍 เลือกช่วงเวลา:
        </span>
        <select
          className="h-10 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        >
          <option value="all">เดือน: ทั้งหมด</option>
          {THAI_MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>

        <select
          className="h-10 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="all">ปี: ทั้งหมด</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y + 543}
            </option>
          ))}
        </select>

        <select
          className="h-10 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">ประเภท: ทั้งหมด</option>
          <option value="Income">รายรับ (Income)</option>
          <option value="Expense">รายจ่าย (Expense)</option>
        </select>
      </Card>

      {/* Transactions Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>วันที่</TableHead>
              <TableHead>ประเภท</TableHead>
              <TableHead>หมวดหมู่ / ช่องทาง</TableHead>
              <TableHead>ผู้รับเรื่อง / อ้างอิง</TableHead>
              <TableHead className="text-right">จำนวนเงิน (฿)</TableHead>
              <TableHead>โน้ต</TableHead>
              <TableHead className="text-center w-20">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-12 text-slate-400"
                >
                  ไม่มีข้อมูลรายการบัญชี
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((t) => {
                const isIncome = t.type === "Income"
                return (
                  <TableRow key={t.transactionid}>
                    <TableCell className="text-xs text-slate-300">
                      {t.date
                        ? new Date(t.date).toLocaleDateString("th-TH")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isIncome ? "success" : "destructive"}>
                        {isIncome ? "รายรับ" : "รายจ่าย"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{t.category}</TableCell>
                    <TableCell className="text-slate-300">
                      {t.reference || "-"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        isIncome ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {isIncome ? "+" : "-"}
                      {(parseFloat(t.amount) || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{" "}
                      ฿
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {t.note || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          handleDeleteTransaction(String(t.transactionid))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add Transaction Modal */}
      <Dialog open={transOpen} onOpenChange={(v) => !v && setTransOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกรายการบัญชี</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddTransaction} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>วันที่ *</Label>
              <Input
                type="date"
                value={transDate}
                onChange={(e) => setTransDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>ประเภทรายการ *</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                value={transType}
                onChange={(e) => {
                  const val = e.target.value as "Income" | "Expense"
                  setTransType(val)
                  setTransCategory("")
                }}
              >
                <option value="Income">รายรับ (Income)</option>
                <option value="Expense">รายจ่าย (Expense)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>
                {transType === "Income"
                  ? "ช่องทางรายรับ (ReadRealm) *"
                  : "หมวดหมู่ (เช่น ค่าแปล, ค่าคลีน) *"}
              </Label>
              {transType === "Income" ? (
                <SearchableSelect
                  options={combinedWebsites.map((w) => ({
                    value: w,
                    label: w,
                  }))}
                  value={transCategory}
                  onChange={setTransCategory}
                  placeholder="-- เลือกช่องทาง --"
                />
              ) : (
                <Input
                  placeholder="เช่น ค่าแปล, ค่าลงคำ"
                  value={transCategory}
                  onChange={(e) => setTransCategory(e.target.value)}
                  required
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                {transType === "Expense"
                  ? "จ่ายให้ใคร (เลือกจากรายชื่อผู้รับเงิน หรือ พิมพ์เอง)"
                  : "อ้างอิง (เช่น รหัสแคมเปญ)"}
              </Label>
              {transType === "Expense" && payeeList.length > 0 && (
                <SearchableSelect
                  options={payeeList.map((p) => ({
                    value: p.name,
                    label: `${p.name} (${p.bankname || "ไม่ระบุธนาคาร"})`,
                  }))}
                  value={transReference}
                  onChange={setTransReference}
                  placeholder="-- เลือกผู้รับเงิน --"
                />
              )}
              <Input
                placeholder="ชื่อบุคคล หรือ เลขอ้างอิง"
                value={transReference}
                onChange={(e) => setTransReference(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>จำนวนเงิน (บาท) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={transAmount}
                onChange={(e) => setTransAmount(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>หมายเหตุ</Label>
              <Textarea
                rows={2}
                value={transNote}
                onChange={(e) => setTransNote(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTransOpen(false)}
                disabled={submittingTrans}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submittingTrans}>
                {submittingTrans ? "กำลังบันทึก..." : "บันทึกรายการ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Payee Management Modal */}
      <Dialog
        open={payeeModalOpen}
        onOpenChange={(v) => !v && setPayeeModalOpen(false)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader className="flex flex-row items-center justify-between pr-6">
            <DialogTitle>
              จัดการรายชื่อผู้รับเงินและเลขผู้เสียภาษี
            </DialogTitle>
            <Button
              size="sm"
              onClick={() => {
                setEditPayeeId("")
                setPayeeName("")
                setPayeeTaxId("")
                setPayeeBankAccount("")
                setPayeeBankName("")
                setPayeeNote("")
                setShowPayeeForm(true)
              }}
            >
              <Plus className="h-4 w-4" /> เพิ่มชื่อใหม่
            </Button>
          </DialogHeader>

          {showPayeeForm && (
            <form
              onSubmit={handleSavePayee}
              className="rounded-xl border border-[#26334d] bg-[#0d1322] p-4 space-y-3"
            >
              <h4 className="font-semibold text-sm text-indigo-300">
                {editPayeeId ? "แก้ไขข้อมูลผู้รับเงิน" : "เพิ่มรายชื่อผู้รับเงิน"}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>ชื่อ-นามสกุล *</Label>
                  <Input
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>เลขบัตรประชาชน / เลขผู้เสียภาษี *</Label>
                  <Input
                    value={payeeTaxId}
                    onChange={(e) => setPayeeTaxId(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>เลขบัญชีธนาคาร</Label>
                  <Input
                    placeholder="เช่น 012-3-45678-9"
                    value={payeeBankAccount}
                    onChange={(e) => setPayeeBankAccount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>ธนาคาร (เช่น กสิกร, ไทยพาณิชย์)</Label>
                  <Input
                    value={payeeBankName}
                    onChange={(e) => setPayeeBankName(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <Label>โน้ตเพิ่มเติม</Label>
                  <Input
                    value={payeeNote}
                    onChange={(e) => setPayeeNote(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPayeeForm(false)}
                >
                  ยกเลิก
                </Button>
                <Button type="submit" size="sm" disabled={submittingPayee}>
                  {submittingPayee ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-xl border border-[#26334d] overflow-hidden max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>เลขผู้เสียภาษี</TableHead>
                  <TableHead>เลขบัญชี</TableHead>
                  <TableHead>ธนาคาร</TableHead>
                  <TableHead>โน้ต</TableHead>
                  <TableHead className="text-center w-24">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payeeList.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-slate-400"
                    >
                      ยังไม่มีรายชื่อผู้รับเงิน
                    </TableCell>
                  </TableRow>
                ) : (
                  payeeList.map((p) => (
                    <TableRow key={p.payeeid}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.taxid}</TableCell>
                      <TableCell className="text-xs">
                        {p.bankaccount || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.bankname || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {p.note || "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditPayeeId(String(p.payeeid))
                              setPayeeName(p.name || "")
                              setPayeeTaxId(p.taxid || "")
                              setPayeeBankAccount(p.bankaccount || "")
                              setPayeeBankName(p.bankname || "")
                              setPayeeNote(p.note || "")
                              setShowPayeeForm(true)
                            }}
                          >
                            <Pencil className="h-3 w-3 text-indigo-400" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              handleDeletePayee(String(p.payeeid))
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
