import React, { useState, useEffect } from 'react';
import { X, Send, Mail, Building2, User, FileText } from 'lucide-react';
import { API_BASE } from '../apiConfig';

const MailModal = ({ customer, onClose, onMailSent, subSectors = [] }) => {
    const [mailContent, setMailContent] = useState('');
    const [subject, setSubject] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (customer && subSectors.length > 0) {
            // Find the matching sub-sector by ID
            const matchingSub = subSectors.find(s =>
                s.id === customer.sub_sector_id ||
                s.name?.toLowerCase() === customer.sub_sector_name?.toLowerCase()
            );

            if (matchingSub && (matchingSub.mail_template || matchingSub.mail_subject)) {
                let finalSubject = matchingSub.mail_subject || `${customer.company_name} - İş Birliği Teklifi`;
                let finalContent = matchingSub.mail_template || '';

                // Replace placeholders
                const companyName = customer.company_name || 'Değerli Firma';
                finalSubject = finalSubject.replace(/{{Firma_Adı}}/g, companyName);
                finalContent = finalContent.replace(/{{Firma_Adı}}/g, companyName);

                setSubject(finalSubject);
                setMailContent(finalContent);
            } else {
                setSubject(`İş Birliği Teklifi`);
                setMailContent(`Sayın Yetkili,\n\n${customer.company_name} firması ile yazılım danışmanlığı süreçleri hakkında görüşmek istiyoruz.\n\nİyi çalışmalar.`);
            }
        }
    }, [customer, subSectors]);

    const handleSend = async () => {
        if (!customer.email) {
            alert('Müşterinin e-posta adresi bulunamadı.');
            return;
        }

        setSending(true);
        try {
            // Convert '*' at the beginning of lines to <li> items
            let formattedHtml = mailContent
                .split('\n')
                .map(line => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('*')) {
                        return `<li>${trimmed.substring(1).trim()}</li>`;
                    }
                    return line;
                })
                .join('\n');

            // Wrap consecutive <li> items in <ul> tags
            formattedHtml = formattedHtml.replace(/(<li>.*?<\/li>(\s*\n\s*)*)+/g, match => {
                return `<ul>${match}</ul>`;
            });

            // Convert remaining newlines to <br>
            formattedHtml = formattedHtml.replace(/\n/g, '<br>');

            const resp = await fetch(`${API_BASE}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: customer.email,
                    subject: subject,
                    html: formattedHtml,
                    customerId: customer.id
                })
            });

            const data = await resp.json();

            if (resp.ok) {
                // Update customer status locally before closing
                try {
                    await fetch(`${API_BASE}/customers/${customer.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'Contacted Mail' })
                    });
                } catch (statusErr) {
                    console.error('Status update failed:', statusErr);
                }

                alert('E-posta başarıyla gönderildi!');
                if (onMailSent) onMailSent();
                onClose();
            } else {
                throw new Error(data.error || 'Gönderim sırasında bir hata oluştu.');
            }
        } catch (err) {
            alert('Hata: ' + err.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && onClose()}>
            <div className="mail-modal-card">
                <header className="modal-header">
                    <div className="header-left">
                        <FileText className="header-icon" strokeWidth={2} />
                        <div>
                            <h3>Sektörel Mail Şablonu</h3>
                            <p>{customer.sub_sector_name} Sektörü İçin Hazır Taslak</p>
                        </div>
                    </div>
                    <button className="close-button" onClick={onClose}><X size={20} /></button>
                </header>

                <div className="modal-body">
                    <div className="customer-mini-card">
                        <div className="info-item">
                            <Building2 size={16} strokeWidth={2} /> <strong>{customer.company_name}</strong>
                        </div>
                        <div className="info-item">
                            <Mail size={16} strokeWidth={2} /> <span>{customer.email}</span>
                        </div>
                        {customer.authorized_person && (
                            <div className="info-item">
                                <User size={16} strokeWidth={2} /> <span>{customer.authorized_person}</span>
                            </div>
                        )}
                    </div>

                    <div className="mail-editor-container">
                        <div className="input-group">
                            <label>E-Posta Konusu</label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Konu başlığı..."
                            />
                        </div>
                        <div className="input-group">
                            <label>Mesaj İçeriği</label>
                            <textarea
                                value={mailContent}
                                onChange={(e) => setMailContent(e.target.value)}
                                placeholder="Şablondaki içerik burada görünecek..."
                            />
                        </div>
                    </div>
                </div>

                <footer className="modal-footer">
                    <button className="secondary-btn" onClick={onClose} disabled={sending}>
                        Kapat
                    </button>
                    <button className="primary-btn" onClick={handleSend} disabled={sending}>
                        <Send size={18} strokeWidth={2} /> {sending ? 'Gönderiliyor...' : 'Mailli Gönder'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default MailModal;
