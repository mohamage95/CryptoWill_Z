import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface WillData {
  id: number;
  title: string;
  encryptedAmount: string;
  beneficiary: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  status: 'active' | 'executed' | 'pending';
}

interface WillStats {
  totalWills: number;
  activeWills: number;
  totalAmount: number;
  avgAmount: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [wills, setWills] = useState<WillData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingWill, setCreatingWill] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newWillData, setNewWillData] = useState({ title: "", amount: "", beneficiary: "" });
  const [selectedWill, setSelectedWill] = useState<WillData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const willsList: WillData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          willsList.push({
            id: parseInt(businessId.replace('will-', '')) || Date.now(),
            title: businessData.name,
            encryptedAmount: businessId,
            beneficiary: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            status: businessData.isVerified ? 'executed' : 'active'
          });
        } catch (e) {
          console.error('Error loading will data:', e);
        }
      }
      
      setWills(willsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createWill = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingWill(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted will with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newWillData.amount) || 0;
      const businessId = `will-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newWillData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newWillData.amount) || 0,
        0,
        newWillData.beneficiary
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted will created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewWillData({ title: "", amount: "", beneficiary: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingWill(false); 
    }
  };

  const decryptWill = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Will already executed" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Executing will..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Will executed successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Will is already executed" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Execution failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const getWillStats = (): WillStats => {
    const totalWills = wills.length;
    const activeWills = wills.filter(w => w.status === 'active').length;
    const totalAmount = wills.reduce((sum, w) => sum + (w.decryptedValue || w.publicValue1 || 0), 0);
    const avgAmount = totalWills > 0 ? totalAmount / totalWills : 0;

    return { totalWills, activeWills, totalAmount, avgAmount };
  };

  const filteredWills = wills.filter(will =>
    will.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    will.beneficiary.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedWills = filteredWills.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredWills.length / itemsPerPage);

  const renderStats = () => {
    const stats = getWillStats();
    
    return (
      <div className="stats-panels">
        <div className="stat-panel gradient-panel">
          <div className="stat-icon">📜</div>
          <div className="stat-content">
            <h3>Total Wills</h3>
            <div className="stat-value">{stats.totalWills}</div>
          </div>
        </div>
        
        <div className="stat-panel gradient-panel">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Active Wills</h3>
            <div className="stat-value">{stats.activeWills}</div>
          </div>
        </div>
        
        <div className="stat-panel gradient-panel">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Value</h3>
            <div className="stat-value">${stats.totalAmount.toLocaleString()}</div>
          </div>
        </div>
        
        <div className="stat-panel gradient-panel">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Average Value</h3>
            <div className="stat-value">${stats.avgAmount.toFixed(0)}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Assets</h4>
            <p>Will amount encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store Securely</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Death Oracle</h4>
            <p>Trigger condition verified off-chain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Transfer Assets</h4>
            <p>Homomorphic decryption and transfer</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CryptoWill 🔐</h1>
            <p>FHE-based Encrypted Wills</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔒</div>
            <h2>Secure Your Legacy with FHE</h2>
            <p>Connect your wallet to create encrypted wills that only execute upon verified conditions</p>
            <div className="feature-grid">
              <div className="feature">
                <span>🔐</span>
                <p>FHE Encrypted Assets</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <p>Homomorphic Triggers</p>
              </div>
              <div className="feature">
                <span>🔍</span>
                <p>Death Oracle Verification</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your digital legacy</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted will system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CryptoWill 🔐</h1>
          <p>FHE-based Encrypted Wills</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Create Will
          </button>
          <button 
            onClick={() => setShowFAQ(true)} 
            className="faq-btn"
          >
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Encrypted Will Dashboard</h2>
          {renderStats()}
          
          <div className="fhe-explainer">
            <h3>FHE 🔐 Will Execution Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="wills-section">
          <div className="section-header">
            <h2>Your Encrypted Wills</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search wills..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="wills-list">
            {paginatedWills.length === 0 ? (
              <div className="no-wills">
                <p>No encrypted wills found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Will
                </button>
              </div>
            ) : paginatedWills.map((will, index) => (
              <div 
                className={`will-item ${selectedWill?.id === will.id ? "selected" : ""} ${will.status}`} 
                key={index}
                onClick={() => setSelectedWill(will)}
              >
                <div className="will-header">
                  <div className="will-title">{will.title}</div>
                  <div className={`will-status ${will.status}`}>
                    {will.status === 'executed' ? '✅ Executed' : '🔐 Active'}
                  </div>
                </div>
                <div className="will-details">
                  <div className="detail">
                    <span>Beneficiary:</span>
                    <strong>{will.beneficiary}</strong>
                  </div>
                  <div className="detail">
                    <span>Amount:</span>
                    <strong>
                      {will.isVerified ? 
                        `$${will.decryptedValue}` : 
                        '🔒 Encrypted'
                      }
                    </strong>
                  </div>
                  <div className="detail">
                    <span>Created:</span>
                    <span>{new Date(will.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="will-actions">
                  {!will.isVerified && (
                    <button 
                      className="execute-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        decryptWill(will.encryptedAmount).then(setDecryptedAmount);
                      }}
                      disabled={isDecrypting}
                    >
                      {isDecrypting ? "Executing..." : "Execute Will"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <CreateWillModal 
          onSubmit={createWill} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingWill} 
          willData={newWillData} 
          setWillData={setNewWillData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {showFAQ && (
        <FAQModal onClose={() => setShowFAQ(false)} />
      )}
      
      {selectedWill && (
        <WillDetailModal 
          will={selectedWill} 
          onClose={() => { 
            setSelectedWill(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptWill={() => decryptWill(selectedWill.encryptedAmount).then(setDecryptedAmount)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateWillModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  willData: any;
  setWillData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, willData, setWillData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setWillData({ ...willData, [name]: intValue });
    } else {
      setWillData({ ...willData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-will-modal">
        <div className="modal-header">
          <h2>Create Encrypted Will</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Asset amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Will Title *</label>
            <input 
              type="text" 
              name="title" 
              value={willData.title} 
              onChange={handleChange} 
              placeholder="Enter will title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Asset Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={willData.amount} 
              onChange={handleChange} 
              placeholder="Enter asset amount..." 
              step="1"
              min="0"
            />
            <div className="input-note">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Beneficiary Address *</label>
            <input 
              type="text" 
              name="beneficiary" 
              value={willData.beneficiary} 
              onChange={handleChange} 
              placeholder="Enter beneficiary address..." 
            />
            <div className="input-note">Public Information</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !willData.title || !willData.amount || !willData.beneficiary} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Encrypted Will"}
          </button>
        </div>
      </div>
    </div>
  );
};

const WillDetailModal: React.FC<{
  will: WillData;
  onClose: () => void;
  decryptedAmount: number | null;
  isDecrypting: boolean;
  decryptWill: () => Promise<void>;
}> = ({ will, onClose, decryptedAmount, isDecrypting, decryptWill }) => {
  return (
    <div className="modal-overlay">
      <div className="will-detail-modal">
        <div className="modal-header">
          <h2>Will Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="will-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{will.title}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{will.creator.substring(0, 6)}...{will.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(will.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Beneficiary:</span>
              <strong>{will.beneficiary}</strong>
            </div>
          </div>
          
          <div className="asset-section">
            <h3>Encrypted Assets</h3>
            <div className="asset-display">
              <div className="amount-value">
                {will.isVerified ? 
                  `$${will.decryptedValue}` : 
                  decryptedAmount !== null ? 
                  `$${decryptedAmount}` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <div className="amount-status">
                {will.isVerified ? '✅ On-chain Verified' : 
                 decryptedAmount !== null ? '🔓 Locally Decrypted' : '🔐 Fully Encrypted'}
              </div>
            </div>
          </div>
          
          <div className="fhe-info">
            <h4>FHE Execution Process</h4>
            <div className="process-steps">
              <div className="step">
                <span>1</span>
                <p>Death oracle verifies trigger condition</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Homomorphic computation on encrypted data</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Offline decryption with relayer SDK</p>
              </div>
              <div className="step">
                <span>4</span>
                <p>On-chain verification and asset transfer</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!will.isVerified && (
            <button 
              onClick={decryptWill} 
              disabled={isDecrypting}
              className="execute-btn"
            >
              {isDecrypting ? "Executing..." : "Execute Will"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const faqs = [
    {
      question: "What is FHE-based encrypted will?",
      answer: "FHE (Fully Homomorphic Encryption) allows computation on encrypted data without decryption. Your will details remain encrypted until execution conditions are met."
    },
    {
      question: "How are assets transferred?",
      answer: "When death oracle verifies the trigger condition, the FHE system performs homomorphic computation and transfers assets to beneficiaries automatically."
    },
    {
      question: "Is my data secure?",
      answer: "Yes, all sensitive data is encrypted using Zama FHE technology and can only be decrypted when execution conditions are verified."
    },
    {
      question: "What happens if the oracle fails?",
      answer: "The system has multiple verification layers and failsafe mechanisms to ensure will execution reliability."
    }
  ];

  return (
    <div className="modal-overlay">
      <div className="faq-modal">
        <div className="modal-header">
          <h2>Frequently Asked Questions</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <div key={index} className="faq-item">
                <h4>{faq.question}</h4>
                <p>{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

