using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Swalloop.Core
{
    /// <summary>
    /// A small JSON reader and writer with no dependencies. Objects become
    /// Dictionary&lt;string, object&gt;, arrays List&lt;object&gt;, numbers double.
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string text)
        {
            var p = new Parser(text);
            p.SkipWs();
            var v = p.ReadValue();
            p.SkipWs();
            if (!p.AtEnd) throw p.Fail("unexpected text after the value");
            return v;
        }

        public static string Serialize(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d:
                    if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
                    else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                    break;
                case string s: WriteString(sb, s); break;
                case IDictionary<string, object> o:
                    sb.Append('{');
                    var first = true;
                    foreach (var kv in o)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                case IEnumerable<object> a:
                    sb.Append('[');
                    var firstA = true;
                    foreach (var x in a)
                    {
                        if (!firstA) sb.Append(',');
                        firstA = false;
                        Write(sb, x);
                    }
                    sb.Append(']');
                    break;
                default:
                    throw new ArgumentException("MiniJson cannot write " + v.GetType().Name);
            }
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
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
            sb.Append('"');
        }

        private sealed class Parser
        {
            private readonly string _s;
            private int _i;

            public Parser(string s) { _s = s ?? ""; }
            public bool AtEnd { get { return _i >= _s.Length; } }

            public Exception Fail(string what)
            {
                return new FormatException("Invalid JSON at position " + _i + ": " + what + ".");
            }

            public void SkipWs()
            {
                while (_i < _s.Length && char.IsWhiteSpace(_s[_i])) _i++;
            }

            public object ReadValue()
            {
                if (AtEnd) throw Fail("unexpected end");
                var c = _s[_i];
                if (c == '{') return ReadObject();
                if (c == '[') return ReadArray();
                if (c == '"') return ReadString();
                if (c == 't') return Literal("true", true);
                if (c == 'f') return Literal("false", false);
                if (c == 'n') return Literal("null", null);
                return ReadNumber();
            }

            private object Literal(string word, object value)
            {
                if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0) throw Fail("expected " + word);
                _i += word.Length;
                return value;
            }

            private object ReadNumber()
            {
                var start = _i;
                while (_i < _s.Length && "+-0123456789.eE".IndexOf(_s[_i]) >= 0) _i++;
                if (start == _i) throw Fail("unexpected character '" + _s[_i] + "'");
                if (!double.TryParse(_s.Substring(start, _i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                    throw Fail("bad number");
                return d;
            }

            private string ReadString()
            {
                _i++; // opening quote
                var sb = new StringBuilder();
                while (true)
                {
                    if (AtEnd) throw Fail("unterminated string");
                    var c = _s[_i++];
                    if (c == '"') break;
                    if (c != '\\') { sb.Append(c); continue; }
                    if (AtEnd) throw Fail("unterminated escape");
                    var e = _s[_i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 > _s.Length) throw Fail("bad \\u escape");
                            sb.Append((char)Convert.ToInt32(_s.Substring(_i, 4), 16));
                            _i += 4;
                            break;
                        default: throw Fail("bad escape \\" + e);
                    }
                }
                return sb.ToString();
            }

            private List<object> ReadArray()
            {
                _i++;
                var list = new List<object>();
                SkipWs();
                if (!AtEnd && _s[_i] == ']') { _i++; return list; }
                while (true)
                {
                    SkipWs();
                    list.Add(ReadValue());
                    SkipWs();
                    if (AtEnd) throw Fail("unterminated array");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == ']') { _i++; return list; }
                    throw Fail("expected , or ]");
                }
            }

            private Dictionary<string, object> ReadObject()
            {
                _i++;
                var obj = new Dictionary<string, object>();
                SkipWs();
                if (!AtEnd && _s[_i] == '}') { _i++; return obj; }
                while (true)
                {
                    SkipWs();
                    if (AtEnd || _s[_i] != '"') throw Fail("expected a key");
                    var key = ReadString();
                    SkipWs();
                    if (AtEnd || _s[_i] != ':') throw Fail("expected :");
                    _i++;
                    SkipWs();
                    obj[key] = ReadValue();
                    SkipWs();
                    if (AtEnd) throw Fail("unterminated object");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == '}') { _i++; return obj; }
                    throw Fail("expected , or }");
                }
            }
        }
    }
}
