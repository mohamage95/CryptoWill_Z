pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedWill is ZamaEthereumConfig {
    struct Will {
        string encryptedContent;
        euint32 encryptedTriggerCondition;
        address testator;
        address beneficiary;
        uint256 creationTimestamp;
        uint256 executionTimestamp;
        bool isExecuted;
    }

    mapping(string => Will) public wills;
    mapping(string => bool) public willExists;

    event WillCreated(string indexed willId, address indexed testator);
    event WillExecuted(string indexed willId, address indexed beneficiary);

    modifier onlyTestator(string calldata willId) {
        require(wills[willId].testator == msg.sender, "Only testator can modify");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function createWill(
        string calldata willId,
        string calldata encryptedContent,
        externalEuint32 encryptedTriggerCondition,
        bytes calldata inputProof,
        address beneficiary
    ) external {
        require(!willExists[willId], "Will already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedTriggerCondition, inputProof)), "Invalid encrypted condition");

        wills[willId] = Will({
            encryptedContent: encryptedContent,
            encryptedTriggerCondition: FHE.fromExternal(encryptedTriggerCondition, inputProof),
            testator: msg.sender,
            beneficiary: beneficiary,
            creationTimestamp: block.timestamp,
            executionTimestamp: 0,
            isExecuted: false
        });

        FHE.allowThis(wills[willId].encryptedTriggerCondition);
        FHE.makePubliclyDecryptable(wills[willId].encryptedTriggerCondition);

        willExists[willId] = true;

        emit WillCreated(willId, msg.sender);
    }

    function updateWill(
        string calldata willId,
        string calldata newEncryptedContent,
        externalEuint32 newEncryptedTriggerCondition,
        bytes calldata inputProof
    ) external onlyTestator(willId) {
        require(!wills[willId].isExecuted, "Will already executed");
        require(FHE.isInitialized(FHE.fromExternal(newEncryptedTriggerCondition, inputProof)), "Invalid encrypted condition");

        wills[willId].encryptedContent = newEncryptedContent;
        wills[willId].encryptedTriggerCondition = FHE.fromExternal(newEncryptedTriggerCondition, inputProof);

        FHE.allowThis(wills[willId].encryptedTriggerCondition);
        FHE.makePubliclyDecryptable(wills[willId].encryptedTriggerCondition);
    }

    function executeWill(
        string calldata willId,
        bytes memory abiEncodedClearCondition,
        bytes memory decryptionProof
    ) external {
        require(willExists[willId], "Will does not exist");
        require(!wills[willId].isExecuted, "Will already executed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(wills[willId].encryptedTriggerCondition);

        FHE.checkSignatures(cts, abiEncodedClearCondition, decryptionProof);

        uint32 decodedCondition = abi.decode(abiEncodedClearCondition, (uint32));
        require(decodedCondition == 1, "Trigger condition not met");

        wills[willId].isExecuted = true;
        wills[willId].executionTimestamp = block.timestamp;

        emit WillExecuted(willId, wills[willId].beneficiary);
    }

    function getWillDetails(string calldata willId) external view returns (
        string memory encryptedContent,
        address testator,
        address beneficiary,
        uint256 creationTimestamp,
        uint256 executionTimestamp,
        bool isExecuted
    ) {
        require(willExists[willId], "Will does not exist");
        Will storage will = wills[willId];

        return (
            will.encryptedContent,
            will.testator,
            will.beneficiary,
            will.creationTimestamp,
            will.executionTimestamp,
            will.isExecuted
        );
    }

    function getEncryptedTriggerCondition(string calldata willId) external view returns (euint32) {
        require(willExists[willId], "Will does not exist");
        return wills[willId].encryptedTriggerCondition;
    }

    function isWillExecuted(string calldata willId) external view returns (bool) {
        require(willExists[willId], "Will does not exist");
        return wills[willId].isExecuted;
    }

    function getTestator(string calldata willId) external view returns (address) {
        require(willExists[willId], "Will does not exist");
        return wills[willId].testator;
    }

    function getBeneficiary(string calldata willId) external view returns (address) {
        require(willExists[willId], "Will does not exist");
        return wills[willId].beneficiary;
    }
}

