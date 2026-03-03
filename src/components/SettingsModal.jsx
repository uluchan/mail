import { useState } from 'react'
import { X, Key, ShieldCheck, Loader2 } from 'lucide-react'
import './SettingsModal.css'

const SettingsModal = ({ onClose, onSave, initialApiKey }) => {
    const [apiKey, setApiKey] = useState(initialApiKey || '')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleAuthenticate = async () => {
        if (!apiKey.trim()) {
            setError('Lütfen bir API anahtarı girin.')
            return
        }

        setLoading(true)
        setError('')

        try {
            // API Key'i doğrulamak için gerçek bir modeller listesi isteği atıyoruz
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
            const data = await response.json()

            if (data.error) {
                // Google'dan gelen hata mesajını gösteriyoruz
                throw new Error(data.error.message || 'Geçersiz API Anahtarı')
            }

            // Başarılı ise üst bileşene ilet
            onSave(apiKey)
            alert('Bağlantı Başarılı! Servisler yüklendi.')
            onClose()
        } catch (err) {
            setError('Hata: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleOverlayClick = (e) => {
        if (e.target.className === 'modal-overlay') {
            onClose()
        }
    }

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className="modal-content small">
                <div className="modal-header">
                    <div className="header-title">
                        <ShieldCheck className="title-icon" />
                        <h2>Güvenlik Yapılandırması</h2>
                    </div>
                    <button className="close-button" onClick={onClose} disabled={loading}>
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="input-group">
                        <label className="group-label">Gemini API Key</label>
                        <div className="api-input-wrapper">
                            <Key className="input-icon" size={18} />
                            <input
                                type="password"
                                placeholder="Özel anahtarınızı buraya yapıştırın..."
                                value={apiKey}
                                onChange={(e) => {
                                    setApiKey(e.target.value)
                                    if (error) setError('')
                                }}
                                disabled={loading}
                            />
                        </div>
                        {error && <div className="error-message-box">{error}</div>}
                        <p className="security-note">
                            Anahtarlarınız şifrelenir ve sadece bu oturumda tarayıcınızda saklanır.
                        </p>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose} disabled={loading}>İptal</button>
                    <button
                        className="save-btn"
                        onClick={handleAuthenticate}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="spin" size={18} /> : 'Doğrula ve Bağlan'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default SettingsModal
