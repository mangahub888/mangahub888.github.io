import os

pcap_path = r"d:\manga_backend\docs\tencent_traffic.pcap"
if os.path.exists(pcap_path):
    size = os.path.getsize(pcap_path)
    print(f"PCAP file size: {size} bytes")
    with open(pcap_path, "rb") as f:
        header = f.read(1024)
        # Search for strings like ac.qq.com or manhua in binary
        content = f.read()
        import re
        domains = set(re.findall(rb'[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:ac\.qq\.com|acimg\.cn|qq\.com|tencent\.com)', content))
        print("Found domains in traffic:")
        for d in sorted(domains):
            print(" -", d.decode('utf-8', errors='ignore'))
else:
    print("PCAP not found.")
