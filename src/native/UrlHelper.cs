// Chrome/Edge omnibox reader (plan §9.2, ADR-0008). One JSON line per stdin request.
//   ping -> {"ok":true}
//   fg   -> {"ok":true,"hwnd":<int>,"value":"..."} | {"ok":false,"error":"..."}
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

static class UrlHelper
{
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    static IntPtr cachedHwnd = IntPtr.Zero;
    static AutomationElement cachedEdit;

    static readonly Condition OmniboxCondition = new AndCondition(
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
        new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true));

    [STAThread]
    static int Main()
    {
        var stdout = Console.Out;
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string cmd = line.Trim();
            string reply;
            if (cmd == "ping") reply = "{\"ok\":true}";
            else if (cmd == "fg") reply = Foreground();
            else if (cmd == "") continue;
            else reply = Err("unknown command");
            stdout.WriteLine(reply);
            stdout.Flush();
        }
        return 0;
    }

    static string Foreground()
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return Err("no foreground window");
            string value;
            try { value = Read(hwnd, false); }
            catch (ElementNotAvailableException) { value = Read(hwnd, true); }
            if (value == null) return Err("no omnibox");
            return "{\"ok\":true,\"hwnd\":" + hwnd.ToInt64() + ",\"value\":\"" + Esc(value) + "\"}";
        }
        catch (Exception e)
        {
            cachedHwnd = IntPtr.Zero;
            cachedEdit = null;
            return Err(e.GetType().Name + ": " + e.Message);
        }
    }

    static string Read(IntPtr hwnd, bool refind)
    {
        if (refind || hwnd != cachedHwnd || cachedEdit == null)
        {
            cachedHwnd = hwnd;
            cachedEdit = AutomationElement.FromHandle(hwnd).FindFirst(TreeScope.Descendants, OmniboxCondition);
            if (cachedEdit == null) { cachedHwnd = IntPtr.Zero; return null; }
        }
        var vp = (ValuePattern)cachedEdit.GetCurrentPattern(ValuePattern.Pattern);
        return vp.Current.Value ?? "";
    }

    static string Err(string msg)
    {
        return "{\"ok\":false,\"error\":\"" + Esc(msg) + "\"}";
    }

    static string Esc(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
