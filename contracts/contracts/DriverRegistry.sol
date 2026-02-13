// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct DriverProfile {
    address wallet;
    string plateNumber;
    string countryCode;
    string carMake;
    string carModel;
    bool active;
    uint256 registeredAt;
}

contract DriverRegistry {
    mapping(bytes32 => DriverProfile) public drivers;
    mapping(address => bytes32) public walletToPlate;

    event DriverRegistered(address indexed wallet, string plateNumber);
    event DriverUpdated(address indexed wallet, string plateNumber);
    event DriverDeactivated(address indexed wallet, string plateNumber);

    error AlreadyRegistered();
    error NotRegistered();
    error NotOwner();

    modifier onlyRegistered() {
        bytes32 plateHash = walletToPlate[msg.sender];
        if (plateHash == bytes32(0)) revert NotRegistered();
        _;
    }

    function register(
        string calldata plateNumber,
        string calldata countryCode,
        string calldata carMake,
        string calldata carModel
    ) external {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        if (drivers[plateHash].wallet != address(0)) revert AlreadyRegistered();
        if (walletToPlate[msg.sender] != bytes32(0)) revert AlreadyRegistered();

        drivers[plateHash] = DriverProfile({
            wallet: msg.sender,
            plateNumber: plateNumber,
            countryCode: countryCode,
            carMake: carMake,
            carModel: carModel,
            active: true,
            registeredAt: block.timestamp
        });

        walletToPlate[msg.sender] = plateHash;
        emit DriverRegistered(msg.sender, plateNumber);
    }

    function updateProfile(
        string calldata carMake,
        string calldata carModel
    ) external onlyRegistered {
        bytes32 plateHash = walletToPlate[msg.sender];
        DriverProfile storage profile = drivers[plateHash];

        profile.carMake = carMake;
        profile.carModel = carModel;

        emit DriverUpdated(msg.sender, profile.plateNumber);
    }

    function deactivate() external onlyRegistered {
        bytes32 plateHash = walletToPlate[msg.sender];
        DriverProfile storage profile = drivers[plateHash];
        profile.active = false;

        emit DriverDeactivated(msg.sender, profile.plateNumber);
    }

    function isRegistered(string calldata plateNumber) external view returns (bool) {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        return drivers[plateHash].wallet != address(0) && drivers[plateHash].active;
    }

    function getDriver(string calldata plateNumber) external view returns (DriverProfile memory) {
        bytes32 plateHash = keccak256(abi.encodePacked(plateNumber));
        return drivers[plateHash];
    }

    function getDriverByWallet(address wallet) external view returns (DriverProfile memory) {
        bytes32 plateHash = walletToPlate[wallet];
        return drivers[plateHash];
    }
}
