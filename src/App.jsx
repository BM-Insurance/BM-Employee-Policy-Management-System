import React, { useState, useEffect, useRef } from 'react';
import {
    Search,
    ShieldCheck,
    User,
    Users,
    HeartPulse,
    AlertTriangle,
    PlusCircle,
    CheckCircle2,
    Camera,
    Upload,
    ArrowRight,
    Moon,
    Sun,
    History,
    Image as ImageIcon,
    Loader2
} from 'lucide-react';
import {
    MAX_TELEGRAM_PHOTOS,
    MAX_TELEGRAM_PHOTO_SIZE_BYTES,
    sendTelegramPhotos,
    sendTelegramText,
} from './telegram';

const API_URL = import.meta.env.VITE_API_URL || '/personal-accidents';
const TG_BOT_TOKEN = import.meta.env.VITE_BOT_TOKEN;
const TG_CHAT_ID = import.meta.env.VITE_RECEIPT_GROUP_ID;
// Canonical display order for benefits
const BENEFIT_ORDER = [
    'Basic Cover',
    'Dental',
    'Optical',
    'Maternity',
    'Checkup',
];


const sortBenefits = (benefits) => {
    if (!benefits) return benefits;
    return [...benefits].sort((a, b) => {
        const ai = BENEFIT_ORDER.findIndex(name => a.type?.toUpperCase().includes(name.toUpperCase()));
        const bi = BENEFIT_ORDER.findIndex(name => b.type?.toUpperCase().includes(name.toUpperCase()));
        const aIdx = ai === -1 ? BENEFIT_ORDER.length : ai;
        const bIdx = bi === -1 ? BENEFIT_ORDER.length : bi;
        return aIdx - bIdx;
    });
};

function App() {
    const [employeeId, setEmployeeId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [policy, setPolicy] = useState(null);

    // Theme state
    const [theme, setTheme] = useState('light');

    // Navigation state
    const [activeTab, setActiveTab] = useState('current');

    // Benefit update state
    const [selectedBenefitIndex, setSelectedBenefitIndex] = useState(null);
    const [rolloverBenefitIndex, setRolloverBenefitIndex] = useState(null);
    const [activeFundingIndex, setActiveFundingIndex] = useState(null);
    const [amountToAdd, setAmountToAdd] = useState('');
    const [updatingBenefit, setUpdatingBenefit] = useState(false);
    const submissionInProgressRef = useRef(false);

    // Payment type state
    const [amountError, setAmountError] = useState(null);
    const [submissionError, setSubmissionError] = useState(null);
    const [paymentType, setPaymentType] = useState(null); // null | 'cash' | 'credit'
    const [awaitingPaymentType, setAwaitingPaymentType] = useState(false);

    // Receipt upload state
    const [awaitingReceiptPhoto, setAwaitingReceiptPhoto] = useState(false);
    const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
    const [addedAmount, setAddedAmount] = useState(0);

    // Cash claim documents
    const [medCertFiles, setMedCertFiles] = useState([]);
    const [prescriptionFiles, setPrescriptionFiles] = useState([]);
    const [receiptFiles, setReceiptFiles] = useState([]);

    // Track which history images have been loaded. Values: 'loading', 'loaded', or undefined
    const [loadedReceipts, setLoadedReceipts] = useState({});

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    const fetchPolicy = async (e) => {
        e.preventDefault();
        if (!employeeId.trim()) return;

        setLoading(true);
        setError(null);
        setPolicy(null);
        setActiveTab('current');
        resetUpdateState();

        try {
            const response = await fetch(API_URL);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Server returned an error');
            }

            // The new API might return the object directly or nestled in a body property
            // depending on how API Gateway is configured, adapt to handle both cases.
            let policies = [];
            if (data.body) {
                const parsedBody = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
                policies = parsedBody.personalaccidents || [];
            } else if (data.personalaccidents) {
                policies = data.personalaccidents;
            } else if (Array.isArray(data)) {
                policies = data;
            }

            if (!Array.isArray(policies)) {
                throw new Error('Invalid data format received from server.');
            }

            const foundPolicy = policies.find(p => p.employee_id === employeeId);

            if (!foundPolicy) {
                setError('No policy found for this Employee ID.');
            } else {
                // Sort benefits into the canonical display order
                const sorted = { ...foundPolicy, benefits: sortBenefits(foundPolicy.benefits) };
                setPolicy(sorted);
            }
        } catch (err) {
            console.error(err);
            setError('System error: Unable to fetch policy details.');
        } finally {
            setLoading(false);
        }
    };

    const resetUpdateState = () => {
        [...medCertFiles, ...prescriptionFiles, ...receiptFiles].forEach(({ preview }) => {
            if (preview) URL.revokeObjectURL(preview);
        });
        setSelectedBenefitIndex(null);
        setRolloverBenefitIndex(null);
        setActiveFundingIndex(null);
        setAmountToAdd('');
        setAmountError(null);
        setSubmissionError(null);
        setPaymentType(null);
        setAwaitingPaymentType(false);
        setAwaitingReceiptPhoto(false);
        setMedCertFiles([]);
        setPrescriptionFiles([]);
        setReceiptFiles([]);
        setAwaitingConfirmation(false);
        setAddedAmount(0);
    };

    const handleUpdateAmount = async (e) => {
        e.preventDefault();
        if (selectedBenefitIndex === null || !amountToAdd) return;

        const amount = parseFloat(amountToAdd);
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid numeric amount.');
            return;
        }

        const rIndex = rolloverBenefitIndex !== null ? rolloverBenefitIndex : selectedBenefitIndex;
        const rBenefit = policy.benefits[rIndex];
        const rUsedAmount = parseFloat(rBenefit.usedAmount) || 0;
        const rTotalAmount = parseFloat(rBenefit.amount) || 1;
        const rRemaining = rTotalAmount - rUsedAmount;

        if (amount > rRemaining) {
            if (!policy.rollover || rIndex === selectedBenefitIndex) {
                setAmountError(`Cannot process. This claim amount (${amount.toFixed(2)}) exceeds the remaining maximum limit for this benefit.`);
            } else {
                setAmountError(`The selected rollover benefit (${rBenefit.type}) does not have enough balance (${rRemaining.toFixed(2)} remaining).`);
            }
            return;
        }

        setAmountError(null);
        setError(null);
        setAddedAmount(amount);
        setActiveFundingIndex(rIndex);
        setAwaitingPaymentType(true);
    };

    const handleSelectPaymentType = (type) => {
        setSubmissionError(null);
        setPaymentType(type);
        setAwaitingPaymentType(false);
        setAwaitingReceiptPhoto(true);
    };

    const handleFileChange = (setter) => (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const selectedFiles = Array.from(e.target.files);
            const totalFiles = medCertFiles.length + prescriptionFiles.length + receiptFiles.length;
            const invalidFile = selectedFiles.find(file => !file.type.startsWith('image/'));
            const oversizedFile = selectedFiles.find(file => file.size > MAX_TELEGRAM_PHOTO_SIZE_BYTES);

            if (invalidFile) {
                setSubmissionError(`"${invalidFile.name}" is not a supported image.`);
                e.target.value = '';
                return;
            }

            if (oversizedFile) {
                setSubmissionError(`"${oversizedFile.name}" is larger than Telegram's 10 MB photo limit.`);
                e.target.value = '';
                return;
            }

            if (totalFiles + selectedFiles.length > MAX_TELEGRAM_PHOTOS) {
                setSubmissionError(`A claim can include at most ${MAX_TELEGRAM_PHOTOS} images in total.`);
                e.target.value = '';
                return;
            }

            setSubmissionError(null);
            const newFiles = selectedFiles.map(file => ({
                file,
                preview: URL.createObjectURL(file)
            }));
            setter(prev => [...prev, ...newFiles]);
            // Reset input so the same file can be selected again if removed
            e.target.value = '';
        }
    };

    const removeFile = (setter, indexToRemove) => {
        setter(prev => prev.filter((item, idx) => {
            if (idx === indexToRemove && item.preview) URL.revokeObjectURL(item.preview);
            return idx !== indexToRemove;
        }));
        setSubmissionError(null);
    };

    const submitClaim = async () => {
        if (submissionInProgressRef.current) return;

        submissionInProgressRef.current = true;
        setUpdatingBenefit(true);
        setError(null);
        setSubmissionError(null);

        try {
            if (!policy || selectedBenefitIndex === null || activeFundingIndex === null) {
                throw new Error('Select a benefit and authorize the claim amount before submitting.');
            }

            if (!['cash', 'credit'].includes(paymentType)) {
                throw new Error('Select Cash or Credit before submitting the claim.');
            }

            const claimAmount = Number(addedAmount);
            if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
                throw new Error('Enter and authorize a valid claim amount before submitting.');
            }

            if (paymentType === 'cash' && (medCertFiles.length === 0 || receiptFiles.length === 0)) {
                throw new Error('Cash claims require a Medical Certificate and a Receipt.');
            }

            const benefit = policy.benefits[activeFundingIndex];
            const originalBenefit = policy.benefits[selectedBenefitIndex];
            if (!benefit || !originalBenefit) {
                throw new Error('The selected benefit is no longer available. Refresh the policy and try again.');
            }

            const usedAmount = Number.parseFloat(benefit.usedAmount) || 0;
            const benefitLimit = Number.parseFloat(benefit.amount);
            const newAmount = Math.round((usedAmount + claimAmount + Number.EPSILON) * 100) / 100;

            if (!Number.isFinite(benefitLimit) || newAmount > benefitLimit) {
                throw new Error('The claim exceeds the remaining amount for the selected funding benefit.');
            }

            const mainMemberName = policy.mainMembers?.[0]?.name || 'Unknown';
            const rolloverText = activeFundingIndex !== selectedBenefitIndex ? ` (Rolled over from ${benefit.type})` : '';

            // ── Build and dispatch notifications ─────────────────────────────

            if (paymentType === 'cash') {
                const allFiles = [
                    ...medCertFiles.map(f => ({ ...f, label: 'Medical Certificate' })),
                    ...prescriptionFiles.map(f => ({ ...f, label: 'Prescription' })),
                    ...receiptFiles.map(f => ({ ...f, label: 'Receipt' }))
                ];

                const docTypes = Array.from(new Set(allFiles.map(f => f.label))).join(', ');
                const summaryMsg = [
                    '📋 Cash Claim Submitted',
                    `👤 Name: ${mainMemberName}`,
                    `🆔 Employee ID: ${employeeId.trim()}`,
                    `🏥 Claim For: ${originalBenefit.type}${rolloverText}`,
                    `💰 Amount: ${claimAmount.toFixed(2)}`,
                    `📎 Documents: ${docTypes} (${allFiles.length} image${allFiles.length > 1 ? 's' : ''})`
                ].join('\n');

                await sendTelegramPhotos({
                    botToken: TG_BOT_TOKEN,
                    chatId: TG_CHAT_ID,
                    files: allFiles.map(item => item.file),
                    caption: summaryMsg,
                });
            } else {
                // Credit claim — text notification only
                const msg = [
                    '💳 Credit Claim Submitted',
                    `👤 Name: ${mainMemberName}`,
                    `🆔 Employee ID: ${employeeId.trim()}`,
                    `🏥 Claim For: ${originalBenefit.type}${rolloverText}`,
                    `💰 Amount: ${claimAmount.toFixed(2)}`,
                    '💳 Payment: Credit'
                ].join('\n');
                await sendTelegramText({
                    botToken: TG_BOT_TOKEN,
                    chatId: TG_CHAT_ID,
                    text: msg,
                });
            }

            // Only update the balance after Telegram confirms the notification.
            const updateUrl = `${API_URL}/${encodeURIComponent(employeeId.trim())}/benefits-used-amount`;
            const response = await fetch(updateUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ benefits: [{ type: benefit.type, usedAmount: newAmount }] })
            });
            let result = null;
            try {
                result = await response.json();
            } catch {
                // Some successful PATCH endpoints return an empty response body.
            }

            if (!response.ok) {
                throw new Error(result?.message || 'Failed to update benefit amount in the database.');
            }

            setPolicy(currentPolicy => ({
                ...currentPolicy,
                benefits: currentPolicy.benefits.map((item, index) =>
                    index === activeFundingIndex ? { ...item, usedAmount: newAmount } : item
                ),
            }));
            resetUpdateState();
            alert('Claim submitted successfully. Telegram was notified and the benefit balance was updated.');
        } catch (err) {
            console.error('Error submitting claim:', err);
            setSubmissionError(`Submission stopped: ${err.message}`);
        } finally {
            submissionInProgressRef.current = false;
            setUpdatingBenefit(false);
        }
    };

    const cancelReceipt = () => {
        resetUpdateState();
    };

    const toggleReceiptImage = (id) => {
        setLoadedReceipts(prev => {
            // If it's already loading/loaded, hide it by removing it.
            if (prev[id]) {
                const newObj = { ...prev };
                delete newObj[id];
                return newObj;
            }
            // Otherwise set to loading state
            return { ...prev, [id]: 'loading' };
        });
    };

    // Derive past requests from actual API policy benefits where usedAmount > 0
    const pastRequests = policy?.benefits
        ? policy.benefits
            .filter(b => parseFloat(b.usedAmount) > 0)
            .map((b, i) => ({
                id: `REQ-${policy.id || 'SYS'}-${i + 1}`,
                date: policy.created_at,
                benefit: b.type,
                amount: parseFloat(b.usedAmount),
                status: 'Processed',
                // Since the API does not store actual receipt URLs natively in this endpoint,
                // we use a generic placeholder to demonstrate the lazy loading architecture requested.
                receiptUrl: `https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=500&auto=format&fit=crop&q=60&rand=${i}`
            }))
        : [];

    return (
        <div className="flex flex-col min-h-screen transition-colors duration-300 bg-[var(--bg-primary)] text-[var(--text-primary)] font-dosis">
            <header className="py-5 px-6 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm sticky top-0 z-10 transition-colors duration-300">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-white rounded-sm flex items-center justify-center shadow-sm overflow-hidden border border-[var(--border-color)]">
                            <img src="/logo192.png" alt="Company Logo" className="w-full h-full object-cover p-1" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-wide">Policy Management</h1>
                            <p className="text-xs text-[var(--text-secondary)] uppercase tracking-widest font-semibold">Corporate Portal</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {policy && (
                            <form onSubmit={fetchPolicy} className="relative hidden md:block w-72">
                                <input
                                    type="text"
                                    placeholder="Employee ID..."
                                    value={employeeId}
                                    onChange={(e) => setEmployeeId(e.target.value)}
                                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-sm py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                                />
                                <Search className="absolute left-3 top-2.5 text-[var(--text-secondary)] w-4 h-4" />
                            </form>
                        )}

                        <button
                            onClick={toggleTheme}
                            className="p-2 rounded-sm border border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--border-color)] transition-colors"
                            aria-label="Toggle Theme"
                        >
                            {theme === 'light' ? <Moon className="w-4 h-4 text-slate-700" /> : <Sun className="w-4 h-4 text-amber-400" />}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 md:px-6 py-10 w-full flex-1">
                {!policy && !loading && (
                    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-700">
                        <div className="w-16 h-16 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm flex items-center justify-center mb-8 shadow-sm">
                            <ShieldCheck className="text-[var(--accent-color)] w-8 h-8" />
                        </div>
                        <h2 className="text-3xl font-bold mb-3 text-center">Retrieve Policy Details</h2>
                        <p className="text-[var(--text-secondary)] mb-8 text-center max-w-md">
                            Enter a valid Employee ID to view personal accident coverages, dependents, and submission history.
                        </p>

                        <form onSubmit={fetchPolicy} className="w-full max-w-md relative shadow-sm">
                            <input
                                type="text"
                                placeholder="Enter Employee ID (e.g. TH31524)"
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm py-4 pl-12 pr-32 text-lg focus:outline-none focus:border-[var(--accent-color)] focus:ring-1 focus:ring-[var(--accent-color)] transition-colors text-[var(--text-primary)]"
                            />
                            <Search className="absolute left-4 top-4 text-[var(--text-secondary)] w-6 h-6" />
                            <button
                                type="submit"
                                disabled={!employeeId.trim()}
                                className="absolute right-2 top-2 bottom-2 bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white rounded-sm px-6 font-semibold transition-colors disabled:opacity-50"
                            >
                                Search
                            </button>
                        </form>
                    </div>
                )}

                {loading && (
                    <div className="flex flex-col items-center justify-center py-32 opacity-70">
                        <ShieldCheck className="w-12 h-12 text-[var(--accent-color)] animate-spin-slow mb-4" />
                        <p className="text-lg tracking-widest text-[var(--text-secondary)] animate-pulse uppercase font-semibold">Accessing Records...</p>
                    </div>
                )}

                {error && (
                    <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] p-4 rounded-sm flex items-center gap-3 mb-8 shadow-sm">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <p className="font-medium">{error}</p>
                    </div>
                )}

                {policy && !loading && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

                        <div className="flex border-b border-[var(--border-color)] mb-8 overflow-x-auto whitespace-nowrap hide-scrollbar">
                            <button
                                onClick={() => setActiveTab('current')}
                                className={`py-3 px-6 font-semibold text-sm transition-colors border-b-2 ${activeTab === 'current' ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                            >
                                Coverage & Processing
                            </button>
                            <button
                                onClick={() => setActiveTab('history')}
                                className={`flex items-center gap-2 py-3 px-6 font-semibold text-sm transition-colors border-b-2 ${activeTab === 'history' ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                            >
                                <History className="w-4 h-4" /> Past Submissions
                            </button>
                        </div>

                        {activeTab === 'current' && (
                            <div className="space-y-6 md:space-y-8">
                                {/* Header info */}
                                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm p-4 md:p-6 shadow-sm">
                                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                        <div>
                                            <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2 mb-1">
                                                <User className="text-[var(--accent-color)] w-6 h-6" />
                                                {policy.employee_id}
                                            </h2>
                                            <p className="text-[var(--text-secondary)] text-sm">Policy Holder Record</p>
                                        </div>

                                        <div className="flex flex-col items-start md:items-end gap-1 text-sm text-[var(--text-secondary)]">
                                            <span className="flex items-center gap-2">
                                                <span className="font-semibold text-[var(--text-primary)]">Details:</span> {policy.additionalDetails || 'N/A'}
                                            </span>
                                            <span className="flex items-center gap-2">
                                                <span className="font-semibold text-[var(--text-primary)]">Created:</span> {new Date(policy.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                    {/* Main Members */}
                                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm shadow-sm overflow-hidden">
                                        <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] p-3 md:p-4 flex items-center gap-2">
                                            <Users className="w-5 h-5 text-[var(--accent-color)]" />
                                            <h3 className="font-semibold">Main Members</h3>
                                        </div>
                                        <div className="divide-y divide-[var(--border-color)]">
                                            {policy.mainMembers?.map((m, i) => (
                                                <div key={i} className="p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                    <div>
                                                        <span className="font-semibold block">{m.name}</span>
                                                        <span className="text-sm text-[var(--text-secondary)]">{m.position}</span>
                                                    </div>
                                                    <span className="text-sm border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1 rounded-sm w-fit">
                                                        {m.phone}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Dependents */}
                                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm shadow-sm overflow-hidden">
                                        <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] p-3 md:p-4 flex items-center gap-2">
                                            <HeartPulse className="w-5 h-5 text-[var(--accent-color)]" />
                                            <h3 className="font-semibold">Registered Dependents</h3>
                                        </div>
                                        {policy.dependents?.length > 0 ? (
                                            <div className="divide-y divide-[var(--border-color)]">
                                                {policy.dependents.map((d, i) => (
                                                    <div key={i} className="p-3 md:p-4 flex items-center justify-between">
                                                        <span className="font-semibold">{d.name}</span>
                                                        <span className="text-xs font-semibold tracking-wider uppercase text-[var(--accent-color)] bg-[var(--accent-color)]/10 px-2 py-1 rounded-sm">
                                                            {d.relation}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-6 text-center text-[var(--text-secondary)] text-sm">
                                                No dependents registered.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Benefits Processing */}
                                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm shadow-sm overflow-hidden">
                                    <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] p-3 md:p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck className="w-5 h-5 text-[var(--accent-color)]" />
                                            <h3 className="font-semibold">Benefit Utilization</h3>
                                        </div>
                                    </div>

                                    {/* Desktop Table View */}
                                    <div className="hidden md:block overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-[var(--border-color)] text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                                                    <th className="p-4 font-semibold">Benefit Type</th>
                                                    <th className="p-4 font-semibold">Max Coverage</th>
                                                    <th className="p-4 font-semibold">Utilized</th>
                                                    <th className="p-4 font-semibold">Status</th>
                                                    <th className="p-4 font-semibold text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-color)]">
                                                {policy.benefits?.map((b, i) => {
                                                    const usedAmount = parseFloat(b.usedAmount) || 0;
                                                    const totalAmount = parseFloat(b.amount) || 1;
                                                    const usedPercent = (usedAmount / totalAmount) * 100;
                                                    const isHighUsage = usedPercent >= 75;
                                                    const isSelected = selectedBenefitIndex === i;

                                                    return (
                                                        <React.Fragment key={i}>
                                                            <tr className={`hover:bg-[var(--bg-primary)] transition-colors ${isSelected ? 'bg-[var(--bg-primary)]' : ''}`}>
                                                                <td className="p-4 font-semibold">{b.type}</td>
                                                                <td className="p-4 text-[var(--text-secondary)]">{totalAmount.toFixed(2)}</td>
                                                                <td className="p-4 font-semibold">{usedAmount.toFixed(2)}</td>
                                                                <td className="p-4">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-16 h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
                                                                            <div
                                                                                className={`h-full ${isHighUsage ? 'bg-[var(--danger)]' : 'bg-[var(--success)]'}`}
                                                                                style={{ width: `${Math.min(usedPercent, 100)}%` }}
                                                                            />
                                                                        </div>
                                                                        <span className={`text-xs font-semibold ${isHighUsage ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}`}>
                                                                            {Math.round(usedPercent)}%
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="p-4 text-right">
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!awaitingReceiptPhoto && !awaitingPaymentType) {
                                                                                setSelectedBenefitIndex(isSelected ? null : i);
                                                                                setRolloverBenefitIndex(null);
                                                                            }
                                                                        }}
                                                                        disabled={awaitingReceiptPhoto || awaitingPaymentType || (!policy?.rollover && usedPercent >= 100)}
                                                                        title={!policy?.rollover && usedPercent >= 100 ? 'Benefit fully utilized — no further claims allowed' : ''}
                                                                        className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-colors border flex items-center gap-1 ml-auto ${isSelected
                                                                            ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-white'
                                                                            : (!policy?.rollover && usedPercent >= 100)
                                                                                ? 'bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)] cursor-not-allowed opacity-60'
                                                                                : 'bg-transparent border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-color)] disabled:opacity-50 disabled:cursor-not-allowed'
                                                                            }`}
                                                                    >
                                                                        <PlusCircle className="w-3 h-3" /> {(!policy?.rollover && usedPercent >= 100) ? 'Limit Reached' : 'Process Claim'}
                                                                    </button>
                                                                    {isHighUsage && usedPercent < 100 && (
                                                                        <p className="text-[10px] text-[var(--danger)] mt-1 flex items-center justify-end gap-1">
                                                                            <AlertTriangle className="w-3 h-3" /> 75%+ utilized — approaching limit
                                                                        </p>
                                                                    )}
                                                                </td>
                                                            </tr>

                                                            {isSelected && (
                                                                <tr>
                                                                    <td colSpan="5" className="p-0 border-b-2 border-[var(--accent-color)]">
                                                                        <div className="bg-[var(--bg-primary)] p-6 animate-in slide-in-from-top-2 flex flex-col border-x border-[var(--border-color)]">
                                                                            {!awaitingPaymentType && !awaitingReceiptPhoto ? (
                                                                                <div className="w-full max-w-xl">
                                                                                    <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">Step 1: Input Claim Amount</h4>
                                                                                    {isHighUsage && (
                                                                                        <div className="mb-3 flex items-center gap-2 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] rounded-sm px-3 py-2 text-xs font-semibold">
                                                                                            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Warning: This benefit is at {Math.round(usedPercent)}% utilization.
                                                                                        </div>
                                                                                    )}
                                                                                    <form onSubmit={handleUpdateAmount} className="flex flex-col gap-4">
                                                                                        <div className="flex gap-4 items-end">
                                                                                            <div className="flex-1">
                                                                                                <label className="block text-xs font-semibold mb-1 text-[var(--text-primary)]">Amount to Process (Numeric)</label>
                                                                                                <input type="number" step="0.01" min="0.01" required value={amountToAdd}
                                                                                                    onChange={(e) => setAmountToAdd(e.target.value)}
                                                                                                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm py-2 px-3 focus:outline-none focus:border-[var(--accent-color)]" />
                                                                                            </div>
                                                                                            <button type="submit" disabled={updatingBenefit}
                                                                                                className="bg-[var(--text-primary)] hover:bg-[var(--accent-color)] text-[var(--bg-secondary)] font-semibold py-2 px-6 rounded-sm transition-colors h-[38px] flex items-center gap-2">
                                                                                                {updatingBenefit ? 'Authorizing...' : 'Authorize'} <ArrowRight className="w-4 h-4" />
                                                                                            </button>
                                                                                        </div>
                                                                                        {policy?.rollover && (
                                                                                            <div className="w-full">
                                                                                                <label className="block text-xs font-semibold mb-1 text-[var(--text-primary)] flex items-center gap-1">
                                                                                                    Funding Source (Rollover Active)
                                                                                                </label>
                                                                                                <select
                                                                                                    value={rolloverBenefitIndex !== null ? rolloverBenefitIndex : selectedBenefitIndex}
                                                                                                    onChange={(e) => setRolloverBenefitIndex(Number(e.target.value))}
                                                                                                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm py-2 px-3 text-sm focus:outline-none focus:border-[var(--accent-color)]"
                                                                                                >
                                                                                                    {policy.benefits.map((ben, idx) => {
                                                                                                        const r = (parseFloat(ben.amount) || 1) - (parseFloat(ben.usedAmount) || 0);
                                                                                                        return (
                                                                                                            <option key={idx} value={idx} disabled={r <= 0}>
                                                                                                                {ben.type} (Remaining: {r.toFixed(2)}) {idx === selectedBenefitIndex ? '(Current)' : ''}
                                                                                                            </option>
                                                                                                        );
                                                                                                    })}
                                                                                                </select>
                                                                                            </div>
                                                                                        )}
                                                                                    </form>
                                                                                    {amountError && (
                                                                                        <p className="text-xs text-[var(--danger)] mt-2 font-semibold">
                                                                                            {amountError}
                                                                                        </p>
                                                                                    )}
                                                                                    <p className="text-xs text-[var(--text-secondary)] mt-2 flex items-center gap-1">
                                                                                        <AlertTriangle className="w-3 h-3" /> Once authorized, amount cannot be modified.
                                                                                    </p>
                                                                                </div>
                                                                            ) : awaitingPaymentType ? (
                                                                                <div className="w-full max-w-xl">
                                                                                    <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--success)] mb-1 flex items-center gap-1">
                                                                                        <CheckCircle2 className="w-4 h-4" /> Step 1 Complete &middot; Step 2: Payment Type
                                                                                    </h4>
                                                                                    <p className="text-xs text-[var(--text-secondary)] mb-4">How is this claim being paid?</p>
                                                                                    <div className="flex gap-3">
                                                                                        <button onClick={() => handleSelectPaymentType('cash')}
                                                                                            className="flex-1 border-2 border-[var(--accent-color)] bg-[var(--accent-color)]/10 hover:bg-[var(--accent-color)]/20 text-[var(--accent-color)] font-bold py-4 rounded-sm transition-colors text-sm">
                                                                                            💵 Cash
                                                                                        </button>
                                                                                        <button onClick={() => handleSelectPaymentType('credit')}
                                                                                            className="flex-1 border-2 border-[var(--border-color)] hover:border-[var(--accent-color)] text-[var(--text-primary)] font-bold py-4 rounded-sm transition-colors text-sm">
                                                                                            💳 Credit
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="w-full">
                                                                                    <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--success)] mb-4 flex items-center gap-1">
                                                                                        <CheckCircle2 className="w-4 h-4" /> Step 2 Complete &middot; Step 3: {paymentType === 'cash' ? 'Upload Documents' : 'Confirm'}
                                                                                    </h4>
                                                                                    {paymentType === 'cash' ? (
                                                                                        <div className="space-y-4 max-w-2xl">
                                                                                            <p className="text-xs text-[var(--text-secondary)] mb-2">Medical Certificate and Receipt are <strong className="text-[var(--danger)]">required</strong>. Prescription is optional.</p>
                                                                                            {[
                                                                                                { label: 'Medical Certificate', files: medCertFiles, setter: setMedCertFiles },
                                                                                                { label: 'Prescription', files: prescriptionFiles, setter: setPrescriptionFiles },
                                                                                                { label: 'Receipt', files: receiptFiles, setter: setReceiptFiles },
                                                                                            ].map(doc => (
                                                                                                <div key={doc.label} className="border border-dashed border-[var(--accent-color)] bg-[var(--accent-color)]/5 rounded-sm p-3">
                                                                                                    <div className="flex items-center justify-between mb-2">
                                                                                                        <span className="text-xs font-semibold text-[var(--accent-color)]">{doc.label}{doc.files.length > 0 ? ` (${doc.files.length})` : ''}</span>
                                                                                                        <label className="cursor-pointer flex items-center gap-1 text-xs font-semibold text-[var(--accent-color)] hover:underline">
                                                                                                            <Upload className="w-3.5 h-3.5" /> Add Images
                                                                                                            <input type="file" accept="image/*" multiple className="hidden"
                                                                                                                onChange={handleFileChange(doc.setter)} />
                                                                                                        </label>
                                                                                                    </div>
                                                                                                    {doc.files.length > 0 ? (
                                                                                                        <div className="flex flex-wrap gap-2">
                                                                                                            {doc.files.map((f, idx) => (
                                                                                                                <div key={idx} className="relative group">
                                                                                                                    <img src={f.preview} alt={`${doc.label} ${idx + 1}`} className="w-16 h-16 object-cover rounded-sm border border-[var(--border-color)]" />
                                                                                                                    <button type="button" onClick={() => removeFile(doc.setter, idx)}
                                                                                                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[var(--danger)] text-white rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                                                        ×
                                                                                                                    </button>
                                                                                                                </div>
                                                                                                            ))}
                                                                                                        </div>
                                                                                                    ) : (
                                                                                                        <p className="text-[11px] text-[var(--text-secondary)] italic">No images selected yet</p>
                                                                                                    )}
                                                                                                </div>
                                                                                            ))}
                                                                                            <div className="flex flex-col gap-2 pt-2">
                                                                                                {paymentType === 'cash' && (medCertFiles.length === 0 || receiptFiles.length === 0) && (
                                                                                                    <p className="text-xs text-[var(--danger)] font-semibold">
                                                                                                        * Please upload at least one Medical Certificate and one Receipt to continue.
                                                                                                    </p>
                                                                                                )}
                                                                                                <div className="flex gap-3">
                                                                                                    <button onClick={submitClaim} disabled={updatingBenefit || (paymentType === 'cash' && (medCertFiles.length === 0 || receiptFiles.length === 0))}
                                                                                                        className="bg-[var(--success)] hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-sm transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                                                                                        {updatingBenefit ? 'Transmitting...' : 'Submit to System'}
                                                                                                    </button>
                                                                                                    <button onClick={resetUpdateState} disabled={updatingBenefit}
                                                                                                        className="border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-bg)] font-semibold py-2 px-6 rounded-sm transition-colors text-sm">
                                                                                                        Void
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="flex flex-col gap-3 max-w-sm">
                                                                                            <p className="text-sm text-[var(--text-secondary)]">Credit payment — no documents required.</p>
                                                                                            <div className="text-xs text-[var(--text-secondary)]">Claim Amount: <strong>{addedAmount}</strong> &bull; Type: <strong>{b.type}</strong></div>
                                                                                            <div className="flex gap-3">
                                                                                                <button onClick={submitClaim} disabled={updatingBenefit}
                                                                                                    className="bg-[var(--success)] hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-sm transition-colors text-sm flex items-center gap-2">
                                                                                                    {updatingBenefit ? 'Transmitting...' : 'Submit to System'}
                                                                                                </button>
                                                                                                <button onClick={resetUpdateState} disabled={updatingBenefit}
                                                                                                    className="border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-bg)] font-semibold py-2 px-6 rounded-sm transition-colors text-sm">
                                                                                                    Void
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                    {submissionError && (
                                                                                        <div role="alert" className="mt-4 flex items-start gap-2 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] rounded-sm px-3 py-2 text-xs font-semibold">
                                                                                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                                                                            <span>{submissionError}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile responsive cards for Benefits */}
                                    <div className="md:hidden divide-y divide-[var(--border-color)]">
                                        {policy.benefits?.map((b, i) => {
                                        
                                            const usedAmount = parseFloat(b.usedAmount) || 0;
                                            const totalAmount = parseFloat(b.amount) || 1;
                                            const usedPercent = (usedAmount / totalAmount) * 100;
                                            const isHighUsage = usedPercent >= 75;
                                            const isSelected = selectedBenefitIndex === i;

                                            return (
                                                <div key={i} className={`p-4 hover:bg-[var(--bg-primary)] transition-colors ${isSelected ? 'bg-[var(--bg-primary)]' : ''}`}>
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="font-semibold text-[var(--text-primary)]">{b.type.toUpperCase()}</span>
                                                        <span className="text-sm font-semibold">{usedAmount.toFixed(2)} / <span className="text-[var(--text-secondary)] font-normal">{totalAmount.toFixed(2)}</span></span>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-3 mb-4">
                                                        <div className="flex-1 h-2 bg-[var(--border-color)] rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full ${isHighUsage ? 'bg-[var(--danger)]' : 'bg-[var(--success)]'}`}
                                                                style={{ width: `${Math.min(usedPercent, 100)}%` }}
                                                            />
                                                        </div>
                                                        <span className={`text-xs font-semibold ${isHighUsage ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'} whitespace-nowrap`}>
                                                            {Math.round(usedPercent)}% Utilized
                                                        </span>
                                                    </div>

                                                    <button
                                                        onClick={() => {
                                                            if (!awaitingReceiptPhoto && !awaitingPaymentType) {
                                                                setSelectedBenefitIndex(isSelected ? null : i);
                                                                setRolloverBenefitIndex(null);
                                                            }
                                                        }}
                                                        disabled={awaitingReceiptPhoto || awaitingPaymentType || (!policy?.rollover && usedPercent >= 100)}
                                                        className={`w-full py-2.5 text-sm font-semibold rounded-sm transition-colors border flex items-center justify-center gap-2 ${isSelected
                                                            ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-white'
                                                            : (!policy?.rollover && usedPercent >= 100)
                                                                ? 'bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)] cursor-not-allowed opacity-60'
                                                                : 'bg-transparent border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-color)] disabled:opacity-50 disabled:cursor-not-allowed'
                                                            }`}
                                                    >
                                                        <PlusCircle className="w-4 h-4" /> {(!policy?.rollover && usedPercent >= 100) ? 'Limit Reached' : isSelected ? 'Cancel Action' : 'Process Claim'}
                                                    </button>
                                                    {isHighUsage && usedPercent < 100 && (
                                                        <p className="text-xs text-[var(--danger)] mt-1 flex items-center gap-1">
                                                            <AlertTriangle className="w-3 h-3" /> 75%+ utilized — approaching limit
                                                        </p>
                                                    )}

                                                    {isSelected && (
                                                        <div className="mt-4 pt-4 border-t-2 border-[var(--accent-color)]">
                                                            {!awaitingPaymentType && !awaitingReceiptPhoto ? (
                                                                <form onSubmit={handleUpdateAmount} className="flex flex-col gap-3">
                                                                    {isHighUsage && (
                                                                        <div className="flex items-center gap-2 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] rounded-sm px-3 py-2 text-xs font-semibold">
                                                                            <AlertTriangle className="w-3 h-3" /> Warning: {Math.round(usedPercent)}% utilized
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">Amount to Process</label>
                                                                        <input type="number" step="0.01" min="0.01" required value={amountToAdd}
                                                                            onChange={(e) => setAmountToAdd(e.target.value)}
                                                                            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm py-3 px-3 focus:outline-none focus:border-[var(--accent-color)] text-[var(--text-primary)]" />
                                                                    </div>
                                                                    {policy?.rollover && (
                                                                        <div>
                                                                            <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">Funding Source (Rollover Active)</label>
                                                                            <select
                                                                                value={rolloverBenefitIndex !== null ? rolloverBenefitIndex : selectedBenefitIndex}
                                                                                onChange={(e) => setRolloverBenefitIndex(Number(e.target.value))}
                                                                                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm py-3 px-3 text-sm focus:outline-none focus:border-[var(--accent-color)]"
                                                                            >
                                                                                {policy.benefits.map((ben, idx) => {
                                                                                    const r = (parseFloat(ben.amount) || 1) - (parseFloat(ben.usedAmount) || 0);
                                                                                    return (
                                                                                        <option key={idx} value={idx} disabled={r <= 0}>
                                                                                            {ben.type} (Remaining: {r.toFixed(2)}) {idx === selectedBenefitIndex ? '(Current)' : ''}
                                                                                        </option>
                                                                                    );
                                                                                })}
                                                                            </select>
                                                                        </div>
                                                                    )}
                                                                    <button type="submit" disabled={updatingBenefit}
                                                                        className="w-full bg-[var(--text-primary)] hover:bg-[var(--accent-color)] text-[var(--bg-secondary)] flex items-center justify-center gap-2 font-semibold py-3 rounded-sm transition-colors">
                                                                        {updatingBenefit ? 'Authorizing...' : 'Authorize Request'} <ArrowRight className="w-4 h-4" />
                                                                    </button>
                                                                    {amountError && (
                                                                        <p className="text-xs text-[var(--danger)] text-center font-semibold">
                                                                            {amountError}
                                                                        </p>
                                                                    )}
                                                                </form>
                                                            ) : awaitingPaymentType ? (
                                                                <div className="flex flex-col gap-3">
                                                                    <h4 className="text-xs font-semibold uppercase text-[var(--success)] flex items-center gap-1">
                                                                        <CheckCircle2 className="w-3 h-3" /> Step 1 Complete — Payment Type
                                                                    </h4>
                                                                    <p className="text-xs text-[var(--text-secondary)]">How is this claim being paid?</p>
                                                                    <div className="flex gap-3">
                                                                        <button onClick={() => handleSelectPaymentType('cash')}
                                                                            className="flex-1 border-2 border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)] font-bold py-3 rounded-sm text-sm">
                                                                            💵 Cash
                                                                        </button>
                                                                        <button onClick={() => handleSelectPaymentType('credit')}
                                                                            className="flex-1 border-2 border-[var(--border-color)] text-[var(--text-primary)] font-bold py-3 rounded-sm text-sm">
                                                                            💳 Credit
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col gap-3">
                                                                    <h4 className="text-xs font-semibold uppercase text-[var(--success)] flex items-center justify-center gap-1">
                                                                        <CheckCircle2 className="w-3 h-3" /> {paymentType === 'cash' ? 'Upload Documents' : 'Confirm Credit Claim'}
                                                                    </h4>
                                                                    {paymentType === 'cash' ? (
                                                                        <>
                                                                            <p className="text-xs text-[var(--text-secondary)] text-center mb-2">Medical Certificate and Receipt are <strong className="text-[var(--danger)]">required</strong>.</p>
                                                                            {[
                                                                                { label: 'Medical Certificate', files: medCertFiles, setter: setMedCertFiles },
                                                                                { label: 'Prescription', files: prescriptionFiles, setter: setPrescriptionFiles },
                                                                                { label: 'Receipt', files: receiptFiles, setter: setReceiptFiles },
                                                                            ].map(doc => (
                                                                                <div key={doc.label} className="w-full border border-dashed border-[var(--accent-color)] bg-[var(--accent-color)]/5 rounded-sm p-3">
                                                                                    <div className="flex items-center justify-between mb-2">
                                                                                        <span className="text-xs font-semibold text-[var(--accent-color)]">{doc.label}{doc.files.length > 0 ? ` (${doc.files.length})` : ''}</span>
                                                                                        <label className="cursor-pointer flex items-center gap-1 text-xs font-semibold text-[var(--accent-color)] hover:underline">
                                                                                            <Upload className="w-3.5 h-3.5" /> Add Images
                                                                                            <input type="file" accept="image/*" multiple className="hidden"
                                                                                                onChange={handleFileChange(doc.setter)} />
                                                                                        </label>
                                                                                    </div>
                                                                                    {doc.files.length > 0 ? (
                                                                                        <div className="flex flex-wrap gap-2">
                                                                                            {doc.files.map((f, idx) => (
                                                                                                <div key={idx} className="relative group">
                                                                                                    <img src={f.preview} alt={`${doc.label} ${idx + 1}`} className="w-12 h-12 object-cover rounded-sm border border-[var(--border-color)]" />
                                                                                                    <button type="button" onClick={() => removeFile(doc.setter, idx)}
                                                                                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[var(--danger)] text-white rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                                        ×
                                                                                                    </button>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>
                                                                                    ) : (
                                                                                        <p className="text-[11px] text-[var(--text-secondary)] italic">No images selected yet</p>
                                                                                    )}
                                                                                </div>
                                                                            ))}
                                                                        </>
                                                                    ) : (
                                                                        <p className="text-xs text-[var(--text-secondary)] text-center">Credit payment — no documents required.</p>
                                                                    )}
                                                                    {paymentType === 'cash' && (medCertFiles.length === 0 || receiptFiles.length === 0) && (
                                                                        <p className="text-xs text-[var(--danger)] font-semibold text-center mt-2">
                                                                            * Upload Medical Certificate and Receipt to submit.
                                                                        </p>
                                                                    )}
                                                                    {submissionError && (
                                                                        <div role="alert" className="flex items-start gap-2 bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] rounded-sm px-3 py-2 text-xs font-semibold">
                                                                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                                                            <span>{submissionError}</span>
                                                                        </div>
                                                                    )}
                                                                    <button onClick={submitClaim} disabled={updatingBenefit || (paymentType === 'cash' && (medCertFiles.length === 0 || receiptFiles.length === 0))}
                                                                        className="w-full bg-[var(--success)] hover:bg-green-700 text-white font-semibold py-3 rounded-sm transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                                                                        {updatingBenefit ? 'Transmitting...' : 'Submit to System'}
                                                                    </button>
                                                                    <button onClick={resetUpdateState} disabled={updatingBenefit}
                                                                        className="w-full border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-bg)] font-semibold py-3 rounded-sm transition-colors text-sm">
                                                                        Void
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-sm p-0 shadow-sm overflow-hidden animate-in fade-in duration-300">
                                <div className="bg-[var(--bg-primary)] border-b border-[var(--border-color)] p-4">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <History className="w-5 h-5 text-[var(--accent-color)]" />
                                        Submission History Log
                                    </h3>
                                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                                        Past claims associated with {policy.employee_id}. Data derived from current benefit metrics.
                                    </p>
                                </div>

                                {pastRequests.length > 0 ? (
                                    <>
                                        {/* Desktop View */}
                                        <div className="hidden md:block overflow-x-auto">
                                            <table className="w-full text-left border-collapse min-w-[600px]">
                                                <thead>
                                                    <tr className="border-b border-[var(--border-color)] text-xs uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--bg-primary)]/50">
                                                        <th className="p-4 font-semibold">Req ID</th>
                                                        <th className="p-4 font-semibold">Date</th>
                                                        <th className="p-4 font-semibold">Benefit Category</th>
                                                        <th className="p-4 font-semibold">Amount</th>
                                                        <th className="p-4 font-semibold">Status</th>
                                                        <th className="p-4 text-xs font-normal text-[var(--text-secondary)] whitespace-nowrap">*Images routed to Admin</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[var(--border-color)]">
                                                    {pastRequests.map((req) => (
                                                        <tr key={req.id} className="hover:bg-[var(--bg-primary)] transition-colors">
                                                            <td className="p-4 font-semibold text-sm">{req.id}</td>
                                                            <td className="p-4 text-sm text-[var(--text-secondary)]">{new Date(req.date).toLocaleDateString()}</td>
                                                            <td className="p-4 text-sm font-medium">{req.benefit}</td>
                                                            <td className="p-4 text-sm font-semibold">{req.amount.toFixed(2)}</td>
                                                            <td className="p-4">
                                                                <span className={`text-xs font-semibold px-2 py-1 rounded-sm border ${req.status === 'Approved' ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20' :
                                                                    'bg-[var(--accent-color)]/10 text-[var(--accent-color)] border-[var(--accent-color)]/20'
                                                                    }`}>
                                                                    {req.status}
                                                                </span>
                                                            </td>
                                                            <td className="p-4"></td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile responsive cards for History */}
                                        <div className="md:hidden divide-y divide-[var(--border-color)]">
                                            {pastRequests.map((req) => (
                                                <div key={req.id} className="p-4 hover:bg-[var(--bg-primary)] transition-colors">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div>
                                                            <span className="font-semibold text-[var(--text-primary)] block">{req.benefit}</span>
                                                            <span className="text-xs text-[var(--text-secondary)]">{req.id} &bull; {new Date(req.date).toLocaleDateString()}</span>
                                                        </div>
                                                        <span className="font-semibold text-sm">{req.amount.toFixed(2)}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-3">
                                                        <span className={`text-xs font-semibold px-2 py-1 rounded-sm border ${req.status === 'Approved' ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20' :
                                                            'bg-[var(--accent-color)]/10 text-[var(--accent-color)] border-[var(--accent-color)]/20'
                                                            }`}>
                                                            {req.status}
                                                        </span>
                                                        <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">*Images routed to Telegram</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>

                                ) : (
                                    <div className="p-8 text-center text-[var(--text-secondary)]">
                                        No past submissions found for this policy.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="mt-8 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] py-8">
                <div className="max-w-6xl mx-auto px-6 flex flex-col items-center gap-2 text-center">
                    <p className="text-sm font-semibold">&copy; {new Date().getFullYear()} All rights reserved to Bizuhan and Mebratu Insurance Brokers</p>
                    <p className="text-[10px] uppercase tracking-widest opacity-80 font-bold mt-1">Powered by Gravity Technology & Meedish LLC</p>
                </div>
            </footer>
        </div>
    );
}

export default App;
