import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, ChevronRight, Edit3, Save, Layout, CheckCircle, Filter } from 'lucide-react';
import { API_BASE } from '../apiConfig';
import './SectorManagementModal.css';

const SectorManagementModal = ({ onClose }) => {
    const [sectors, setSectors] = useState([])
    const [loading, setLoading] = useState(false)
    const [newMainSector, setNewMainSector] = useState('')

    // Sub-sector editing state
    const [editingSub, setEditingSub] = useState(null)
    const [subFormData, setSubFormData] = useState({ name: '', mail_subject: '', mail_template: '' })
    const [showOnlyEmpty, setShowOnlyEmpty] = useState(false)

    useEffect(() => {
        fetchSectors()
    }, [])

    const fetchSectors = async () => {
        setLoading(true)
        try {
            const resp = await fetch(`${API_BASE}/sectors`)
            const data = await resp.json()
            if (Array.isArray(data)) {
                setSectors(data)
            } else {
                setSectors([])
            }
        } catch (err) {
            console.error('Fetch sectors failed:', err)
            setSectors([])
        }
        setLoading(false)
    }

    const addMainSector = async () => {
        if (!newMainSector.trim()) return
        try {
            await fetch(`${API_BASE}/main-sectors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newMainSector })
            })
            setNewMainSector('')
            fetchSectors()
        } catch (err) { alert('Hata: ' + err.message) }
    }

    const deleteMainSector = async (id) => {
        if (!confirm('Tüm alt sektörler de silinecek. Emin misiniz?')) return
        try {
            await fetch(`${API_BASE}/main-sectors/${id}`, { method: 'DELETE' })
            fetchSectors()
        } catch (err) { alert('Hata: ' + err.message) }
    }

    const startAddSub = (mainId) => {
        setEditingSub({ main_sector_id: mainId, isNew: true })
        setSubFormData({ name: '', mail_subject: '', mail_template: '' })
    }

    const startEditSub = (sub) => {
        setEditingSub({ ...sub, isNew: false })
        setSubFormData({
            name: sub.name,
            mail_subject: sub.mail_subject || '',
            mail_template: sub.mail_template || ''
        })
    }

    const saveSubSector = async () => {
        if (!subFormData.name.trim()) return
        const isNew = editingSub.isNew
        const url = isNew ? `${API_BASE}/sub-sectors` : `${API_BASE}/sub-sectors/${editingSub.id}`
        const method = isNew ? 'POST' : 'PUT'

        try {
            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    main_sector_id: editingSub.main_sector_id,
                    name: subFormData.name,
                    mail_subject: subFormData.mail_subject,
                    mail_template: subFormData.mail_template
                })
            })
            setEditingSub(null)
            fetchSectors()
        } catch (err) { alert('Hata: ' + err.message) }
    }

    const deleteSubSector = async (id) => {
        if (!confirm('Bu alt sektörü silmek istediğinize emin misiniz?')) return
        try {
            await fetch(`${API_BASE}/sub-sectors/${id}`, { method: 'DELETE' })
            fetchSectors()
        } catch (err) { alert('Hata: ' + err.message) }
    }

    const handleExport = async () => {
        try {
            const { utils, writeFile } = await import('xlsx');
            const data = [];
            sectors.forEach(main => {
                main.sub_sectors.forEach(sub => {
                    data.push({
                        'Ana Sektör': main.name,
                        'Alt Sektör': sub.name,
                        'Mail Başlığı': sub.mail_subject || '',
                        'Mail Şablonu': sub.mail_template || ''
                    });
                });
                if (main.sub_sectors.length === 0) {
                    data.push({ 'Ana Sektör': main.name, 'Alt Sektör': '', 'Mail Şablonu': '' });
                }
            });

            const ws = utils.json_to_sheet(data);
            const wb = utils.book_new();
            utils.book_append_sheet(wb, ws, "Sektörler");
            writeFile(wb, "oliworks_sektorler.xlsx");
        } catch (err) {
            console.error('Export failed:', err);
            alert('Dışa aktarma hatası!');
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const { read, utils } = await import('xlsx');
                const wb = read(evt.target.result, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const rawData = utils.sheet_to_json(ws);

                const formatted = rawData.map(row => {
                    const getCellValue = (headers) => {
                        const foundKey = Object.keys(row).find(k => headers.includes(k.trim()));
                        return foundKey ? row[foundKey] : null;
                    };
                    return {
                        main_sector: getCellValue(['Ana Sektör', 'Main Sector']),
                        sub_sector: getCellValue(['Alt Sektör', 'Sub Sector']),
                        mail_subject: getCellValue(['Mail Başlığı', 'Subject']),
                        mail_template: getCellValue(['Mail Şablonu', 'Template'])
                    };
                }).filter(item => item.main_sector && item.sub_sector);

                if (formatted.length === 0) return alert('Geçerli veri bulunamadı! Lütfen sütun başlıklarını kontrol edin (Ana Sektör, Alt Sektör, Mail Başlığı, Mail Şablonu).');

                setLoading(true);
                const resp = await fetch(`${API_BASE}/sectors/bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formatted)
                });

                if (resp.ok) {
                    const data = await resp.json();
                    alert(data.message || 'İçe aktarma başarılı!');
                    fetchSectors();
                } else {
                    const errorData = await resp.json();
                    alert('İçe aktarma hatası: ' + (errorData.error || 'Bilinmeyen hata'));
                }
            } catch (err) {
                console.error('Import error:', err);
                alert('Dosya okunurken hata oluştu!');
            } finally {
                setLoading(false);
                e.target.value = ''; // Reset input
            }
        };
        reader.readAsBinaryString(file);
    };

    const downloadSampleTemplate = async () => {
        try {
            const { utils, writeFile } = await import('xlsx');
            const sampleData = [
                {
                    'Ana Sektör': 'Örnek Ana Sektör (Teknoloji)',
                    'Alt Sektör': 'Örnek Alt Sektör (Yazılım)',
                    'Mail Başlığı': 'Yazılım Çözümleri Hakkında',
                    'Mail Şablonu': 'Bu sektör için özel AI talimatı buraya gelecek...'
                }
            ];
            const ws = utils.json_to_sheet(sampleData);
            const wb = utils.book_new();
            utils.book_append_sheet(wb, ws, "Şablon");
            writeFile(wb, "oliworks_sektor_sablonu.xlsx");
        } catch (err) {
            alert('Şablon indirilirken hata oluştu!');
        }
    };

    return (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && onClose()}>
            <div className="sector-modal-content">
                <header className="modal-header">
                    <div className="header-left-side">
                        <div className="header-title">
                            <Layout className="title-icon" strokeWidth={2} />
                            <h2>Sektör ve Şablon Yönetimi</h2>
                        </div>
                        <div className="header-utils">
                            <button className="util-btn link" onClick={downloadSampleTemplate}>
                                Örnek Şablonu İndir
                            </button>
                            <button className="util-btn" onClick={handleExport} title="Excel olarak indir">
                                Dışa Aktar (Excel)
                            </button>
                            <label className="util-btn import-label" title="Excel'den yükle">
                                İçe Aktar (Excel)
                                <input type="file" accept=".xlsx, .xls" onChange={handleImport} hidden />
                            </label>
                            <button 
                                className={`util-btn ${showOnlyEmpty ? 'active-filter' : ''}`} 
                                onClick={() => setShowOnlyEmpty(!showOnlyEmpty)}
                                title="Sadece şablonu boş olanları göster"
                            >
                                <Filter size={14} /> {showOnlyEmpty ? 'Tümünü Göster' : 'Boş Şablonlar'}
                            </button>
                        </div>
                    </div>
                    <button className="close-button" onClick={onClose}><X size={20} /></button>
                </header>

                <div className="modal-body-layout">
                    {/* Main Sectors List */}
                    <div className="main-sectors-panel">
                        <div className="panel-header">
                            <h3>Ana Sektörler</h3>
                            <div className="add-main-input">
                                <input
                                    placeholder="Yeni Ana Sektör..."
                                    value={newMainSector}
                                    onChange={e => setNewMainSector(e.target.value)}
                                    onKeyPress={e => e.key === 'Enter' && addMainSector()}
                                />
                                <button onClick={addMainSector}><Plus size={18} /></button>
                            </div>
                        </div>
                        <div className="sectors-list scrollable">
                            {sectors
                                .map(m => {
                                    const filteredSubs = m.sub_sectors.filter(s => 
                                        !showOnlyEmpty || (!s.mail_subject || !s.mail_template)
                                    );
                                    if (filteredSubs.length === 0 && showOnlyEmpty) return null;
                                    return { ...m, sub_sectors: filteredSubs };
                                })
                                .filter(Boolean)
                                .map(m => (
                                <div key={m.id} className="main-sector-card">
                                    <div className="card-top">
                                        <strong>{m.name}</strong>
                                        <div className="actions">
                                            <button className="add-sub-btn" onClick={() => startAddSub(m.id)}>
                                                <Plus size={14} /> Alt Sektör
                                            </button>
                                            <button className="delete-btn" onClick={() => deleteMainSector(m.id)}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="sub-sectors-list">
                                        {m.sub_sectors.map(s => {
                                            const isComplete = s.mail_subject && s.mail_template;
                                            return (
                                                <div
                                                    key={s.id}
                                                    className={`sub-sector-item ${editingSub?.id === s.id ? 'active' : ''}`}
                                                    onClick={() => startEditSub(s)}
                                                >
                                                    <div className="item-info">
                                                        <ChevronRight size={14} className="folder-icon" />
                                                        <span>{s.name}</span>
                                                        {isComplete && (
                                                            <CheckCircle size={14} className="complete-icon" title="Şablon dolu" />
                                                        )}
                                                    </div>
                                                    <button className="item-delete" onClick={(e) => { e.stopPropagation(); deleteSubSector(s.id); }}>
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        {m.sub_sectors.length === 0 && (
                                            <p className="no-sub-text">Henüz alt sektör eklenmedi.</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Sub Sector / Template Editor */}
                    <div className="template-editor-panel">
                        {editingSub ? (
                            <div className="editor-form">
                                <div className="editor-top-info">
                                    <span className="badge-label">Düzenleniyor</span>
                                    <h3>{editingSub.isNew ? 'Yeni Alt Sektör' : subFormData.name || 'İsimsiz Sektör'}</h3>
                                </div>
                                <div className="field">
                                    <label>Alt Sektör Adı</label>
                                    <input
                                        placeholder="Sektör adını girin..."
                                        value={subFormData.name}
                                        onChange={e => setSubFormData({ ...subFormData, name: e.target.value })}
                                    />
                                </div>
                                <div className="field">
                                    <label>Özel Mail Başlığı (Konu)</label>
                                    <input
                                        placeholder="E-posta konusu ne olsun? Örn: İş Birliği Teklifi..."
                                        value={subFormData.mail_subject}
                                        onChange={e => setSubFormData({ ...subFormData, mail_subject: e.target.value })}
                                    />
                                </div>
                                <div className="field flex-grow">
                                    <label>Özel Mail Şablonu (AI Talimatı)</label>
                                    <textarea
                                        placeholder="AI'ya bu sektör için özel ne söylemek istersiniz? Örn: 'Bu sektöre yazarken daha samimi bir dil kullan' veya 'Şu referanslarımızdan bahsetmeyi unutma'..."
                                        value={subFormData.mail_template}
                                        onChange={e => setSubFormData({ ...subFormData, mail_template: e.target.value })}
                                    />
                                    <p className="hint">Bu talimat mail oluşturulurken ana sisteme eklenecektir.</p>
                                </div>
                                <div className="editor-footer">
                                    <button className="cancel-btn" onClick={() => setEditingSub(null)}>İptal</button>
                                    <button className="save-btn" onClick={saveSubSector}>
                                        <Save size={18} /> Değişiklikleri Kaydet
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="empty-state">
                                <Edit3 size={64} strokeWidth={1} />
                                <h3>Sektör Seçilmedi</h3>
                                <p>Düzenlemek için bir alt sektör seçin veya yeni bir tane oluşturun.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default SectorManagementModal
