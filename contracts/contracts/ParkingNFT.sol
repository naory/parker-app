// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

struct ParkingSession {
    string plateNumber;
    string lotId;
    uint256 entryTime;
    uint256 exitTime;
    uint256 feePaid;
    bool active;
}

contract ParkingNFT is ERC721, Ownable {
    uint256 public nextTokenId;
    mapping(uint256 => ParkingSession) public sessions;
    mapping(bytes32 => uint256) public activeSessionByPlate;
    mapping(address => bool) public authorizedLots;

    event SessionStarted(uint256 indexed tokenId, string plateNumber, string lotId, uint256 entryTime);
    event SessionEnded(uint256 indexed tokenId, string plateNumber, uint256 exitTime, uint256 fee);
    event LotAuthorized(address indexed lot);
    event LotRevoked(address indexed lot);

    error NotAuthorizedLot();
    error NoActiveSession();
    error AlreadyParked();

    modifier onlyAuthorizedLot() {
        if (!authorizedLots[msg.sender]) revert NotAuthorizedLot();
        _;
    }

    constructor() ERC721("Parker Parking NFT", "PARK") Ownable(msg.sender) {
        nextTokenId = 1;
    }

    function authorizeLot(address lot) external onlyOwner {
        authorizedLots[lot] = true;
        emit LotAuthorized(lot);
    }

    function revokeLot(address lot) external onlyOwner {
        authorizedLots[lot] = false;
        emit LotRevoked(lot);
    }

    function startSession(
        string calldata plateNumber,
        string calldata lotId
    ) external onlyAuthorizedLot returns (uint256 tokenId) {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        if (activeSessionByPlate[plateHash] != 0) revert AlreadyParked();

        tokenId = nextTokenId++;

        sessions[tokenId] = ParkingSession({
            plateNumber: plateNumber,
            lotId: lotId,
            entryTime: block.timestamp,
            exitTime: 0,
            feePaid: 0,
            active: true
        });

        activeSessionByPlate[plateHash] = tokenId;

        // Mint NFT to the contract itself (driver can claim later)
        _mint(address(this), tokenId);

        emit SessionStarted(tokenId, plateNumber, lotId, block.timestamp);
    }

    function endSession(
        string calldata plateNumber,
        uint256 feePaid
    ) external onlyAuthorizedLot {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        uint256 tokenId = activeSessionByPlate[plateHash];
        if (tokenId == 0) revert NoActiveSession();

        ParkingSession storage session = sessions[tokenId];
        session.exitTime = block.timestamp;
        session.feePaid = feePaid;
        session.active = false;

        delete activeSessionByPlate[plateHash];

        emit SessionEnded(tokenId, plateNumber, block.timestamp, feePaid);
    }

    function getActiveSession(string calldata plateNumber) external view returns (ParkingSession memory) {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        uint256 tokenId = activeSessionByPlate[plateHash];
        return sessions[tokenId];
    }

    function getSession(uint256 tokenId) external view returns (ParkingSession memory) {
        return sessions[tokenId];
    }

    function isParked(string calldata plateNumber) external view returns (bool) {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        return activeSessionByPlate[plateHash] != 0;
    }
}
