import { useState, useEffect } from 'react';
import { X, Save, User, Building, Mail, Globe, MapPin, Phone, Briefcase, Calendar, MessageSquare, Flag } from 'lucide-react';
import { API_BASE } from '../apiConfig';
import './CustomerModal.css';

function CustomerModal({ customer, onClose, onSave, allSectors }) {
    const [formData, setFormData] = useState({
        company_name: '',
        main_sector_id: '',
        sub_sector_id: '',
        email: '',
        website: '',
        city: '',
        district: '',
        phone: '',
        authorized_person: '',
        last_mail_at: '',
        status: 'New Lead',
        notes: ''
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (customer) {
            // Helper to format date for datetime-local input in LOCAL time
            const formatDateForInput = (dateStr) => {
                if (!dateStr) return '';
                const date = new Date(dateStr);
                // Convert to local time string in YYYY-MM-DDTHH:mm format
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${year}-${month}-${day}T${hours}:${minutes}`;
            };

            setFormData({
                company_name: customer.company_name || '',
                main_sector_id: customer.main_sector_id || '',
                sub_sector_id: customer.sub_sector_id || '',
                email: customer.email || '',
                website: customer.website || '',
                city: customer.city || '',
                district: customer.district || '',
                phone: customer.phone || '',
                authorized_person: customer.authorized_person || '',
                last_mail_at: formatDateForInput(customer.last_mail_at),
                status: customer.status || 'New Lead',
                notes: customer.notes || ''
            });
        }
    }, [customer]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const method = customer ? 'PUT' : 'POST';
            const url = customer ? `${API_BASE}/customers/${customer.id}` : `${API_BASE}/customers`;

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'İşlem başarısız oldu.');
            }

            onSave();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const selectedMainSector = allSectors.find(s => String(s.id) === String(formData.main_sector_id));

    return (
        <div className="modal-overlay">
            <div className="customer-modal">
                <div className="modal-header">
                    <h2>{customer ? 'Müşteri Düzenle' : 'Yeni Müşteri Ekle'}</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    {error && <div className="form-error">{error}</div>}

                    <div className="form-grid">
                        <div className="form-group full-width">
                            <label><Building size={14} /> Şirket Adı</label>
                            <input
                                required
                                value={formData.company_name}
                                onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                                placeholder="Şirket Tam Adı"
                            />
                        </div>

                        <div className="form-group">
                            <label><Briefcase size={14} /> Ana Sektör</label>
                            <select
                                value={formData.main_sector_id}
                                onChange={e => setFormData({ ...formData, main_sector_id: e.target.value, sub_sector_id: '' })}
                            >
                                <option value="">Sektör Seçin</option>
                                {allSectors.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label><Briefcase size={14} /> Alt Sektör</label>
                            <select
                                value={formData.sub_sector_id}
                                onChange={e => setFormData({ ...formData, sub_sector_id: e.target.value })}
                                disabled={!formData.main_sector_id}
                            >
                                <option value="">Alt Sektör Seçin</option>
                                {(selectedMainSector?.sub_sectors || []).map(ss => (
                                    <option key={ss.id} value={ss.id}>{ss.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label><Mail size={14} /> E-posta</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="ornek@sirket.com"
                            />
                        </div>

                        <div className="form-group">
                            <label><Globe size={14} /> Web Sitesi</label>
                            <input
                                value={formData.website}
                                onChange={e => setFormData({ ...formData, website: e.target.value })}
                                placeholder="www.sirket.com"
                            />
                        </div>

                        <div className="form-group">
                            <label><MapPin size={14} /> Şehir</label>
                            <input
                                value={formData.city}
                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                placeholder="İstanbul"
                            />
                        </div>

                        <div className="form-group">
                            <label><MapPin size={14} /> İlçe</label>
                            <input
                                value={formData.district}
                                onChange={e => setFormData({ ...formData, district: e.target.value })}
                                placeholder="Kadıköy"
                            />
                        </div>

                        <div className="form-group">
                            <label><Phone size={14} /> Telefon</label>
                            <input
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                placeholder="05XX XXX XX XX"
                            />
                        </div>

                        <div className="form-group">
                            <label><User size={14} /> Yetkili Kişi</label>
                            <input
                                value={formData.authorized_person}
                                onChange={e => setFormData({ ...formData, authorized_person: e.target.value })}
                                placeholder="Ad Soyad"
                            />
                        </div>

                        <div className="form-group">
                            <label><Calendar size={14} /> Son Mail Tarihi</label>
                            <input
                                type="datetime-local"
                                value={formData.last_mail_at}
                                onChange={e => setFormData({ ...formData, last_mail_at: e.target.value })}
                            />
                        </div>

                        <div className="form-group full-width">
                            <label><Flag size={14} /> Müşteri Durumu (Status)</label>
                            <select
                                value={formData.status}
                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                className="status-select-large"
                            >
                                <option value="New Lead">New Lead - Yeni eklenen müşteri</option>
                                <option value="Contacted Call">Contacted Call - İlk temas kuruldu (Arama)</option>
                                <option value="Contacted Mail">Contacted Mail - İlk temas kuruldu (Mail)</option>
                                <option value="No Response">No Response - Dönüş olmadı</option>
                                <option value="Interested">Interested - İlgileniyor</option>
                                <option value="Meeting Scheduled">Meeting Scheduled - Toplantı planlandı</option>
                                <option value="Proposal Sent">Proposal Sent - Teklif gönderildi</option>
                                <option value="Closed Won">Closed Won - Satış oldu</option>
                                <option value="Closed Lost">Closed Lost - Satış olmadı</option>
                            </select>
                        </div>

                        <div className="form-group full-width">
                            <label><MessageSquare size={14} /> Notlar</label>
                            <textarea
                                value={formData.notes}
                                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                placeholder="Müşteri hakkında özel notlar..."
                                rows={4}
                                className="form-textarea"
                            />
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="cancel-btn" onClick={onClose}>İptal</button>
                        <button type="submit" className="save-btn" disabled={loading}>
                            {loading ? <div className="spinner-small"></div> : <Save size={18} />}
                            {customer ? 'Güncelle' : 'Kaydet'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CustomerModal;
